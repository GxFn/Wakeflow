#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildWakeflowTrace } from "../lib/wakeflow-trace.mjs";
import { loadWorkspaceConfig, testWindowNames, workspaceLedgerPaths } from "./lib/wakeflow-config.mjs";
import {
  detectInterfaceLanguage,
  localizedTemplateName,
  normalizeInterfaceLanguage,
  wakeflowStateLocale,
} from "./lib/wakeflow-language.mjs";
import {
  controllerReductionScope,
  controllerReviewScope,
  hasPendingReworkDecision,
  isReworkRouteTask,
  reductionStatusForTargetTask,
  taskExpectsTargetResult,
} from "./lib/wakeflow-review-scope.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import { releaseWindowLockForResult } from "./lib/wakeflow-delivery-store.mjs";
import {
  stableArtifactPart,
  transportArtifactFileName,
} from "./lib/wakeflow-artifact-identity.mjs";
import {
  dispatchPacketDigest,
  dispatchPreparationDigest,
} from "./lib/wakeflow-idempotency.mjs";
import {
  archivePrivacyFindingCounts,
  redactStateRootIntoCopy,
  scanStateRootForArchivePrivacy,
} from "./lib/wakeflow-redaction.mjs";
import { WakeflowStateLockTimeoutError, withFileLock, withStateRootLock } from "./lib/wakeflow-state-lock.mjs";
import { PROGRESS_SECTIONS, appendProgressTimeline } from "./lib/wakeflow-progress-appends.mjs";
import {
  activeDemandPlacementSummary,
  activeDemandConflictSummary,
  isWakeflowInitStagingEntry,
  scanUnarchivedDemandStateRoots,
} from "./lib/wakeflow-active-demands.mjs";
import { archiveWorkspaceTodo, refreshWorkspaceProjection } from "./lib/wakeflow-workspace-projection.mjs";
import {
  currentStateRootResults,
  readStateRootTargetResultItems,
  selectCurrentStateRootResults,
} from "./lib/wakeflow-state-results.mjs";
import {
  TASK_CONTEXT_VERSION,
  normalizeTaskPackageContext,
  requirementRefIssue,
} from "./lib/wakeflow-task-package.mjs";
import {
  DEMAND_AUTHORITY_FILE,
  DEMAND_TYPES,
  assertDemandAuthorityReady,
  demandAuthorityDigest,
  demandAuthorityProjectionStatus,
} from "./lib/wakeflow-demand-authority.mjs";
import {
  COMMIT_DISPOSITIONS,
  evaluateTargetResultContract,
  targetResultContractIssueMessage,
} from "./lib/wakeflow-result-contract.mjs";
import { inspectMainlineHealth } from "./lib/wakeflow-mainline-health.mjs";
import { resolvePodTargetWorkRoot } from "./lib/wakeflow-pod-runtime.mjs";
import {
  controllerEventStateAlignment,
  futureControllerEvents,
  readControllerEventsStrict,
  WakeflowControllerEventLogError,
} from "./lib/wakeflow-controller-events.mjs";
import {
  assertStateAuthorityPaths,
  commitStateTransition,
  readPendingStateTransition,
  recoverPendingStateTransition,
  WakeflowPendingTransitionError,
} from "./lib/wakeflow-state-transition.mjs";

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
  node scripts/wakeflow-state.mjs init --demand-key <key> --title <title> [--demand-type <requirement|bug|supplement|research>] [--demand-authority <json>] [--placement <main|pod>] [--authorization-ref <user-authority>] [--pod-id <id>] [--goal <text>] [--completion-definition <text>] [--test-decision <text>] [--stage-plan <text>] [--controller-window <window>] [--language <auto|zh|en>] [--root <workspace>] [--state-root <path>] [--write] [--json]
  node scripts/wakeflow-state.mjs add-task-package --state-root <path> --task-package-id <id> --summary <text> [--demand-authority <json>] [--work-type <implementation|research|documentation|test> --objective <text> --context-summary <json> --requirement-refs <json> --boundaries <json> --completion-expectations <json> --depends-on-task-ids <json> --commit-expectation <commit|leave-uncommitted>] [--source-ref <ref>] [--design-intent <text>] [--acceptance-anchors <json>] [--evidence-contract <json>] [--target-window <window>] [--target-task-id <id>] [--replaces-target-task-id <id>] [--target-summary <text>] [--test-card-id <id>] [--test-continuation-of <task-id>] [--restart-test --test-restart-reason <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs import-target-result --state-root <path> --target-task-id <id> --target-window <window> --status <completed|blocked|needs-review> [--result-id <id>] [--dispatch-group <id>] [--supersede-result] [--changed-repo <repo>] [--commit <hash>] [--commit-disposition <committed|left-uncommitted|no-changes>] [--evidence-ref <ref>] [--verification <text>] [--risk <text>] [--craft-evidence <json>] [--summary <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs reduce-results --state-root <path> [--write] [--json]
  node scripts/wakeflow-state.mjs decide-review --state-root <path> --candidate-id <id> --decision <accept|rework|blocked|redesign> --reason <text> [--evidence-ref <ref>] [--accept-blocked] [--write] [--json]
  node scripts/wakeflow-state.mjs complete-demand --state-root <path> --reason <text> --evidence-ref <ref> [--write] [--json]
  node scripts/wakeflow-state.mjs continue-demand --state-root <path> --continuation-type <verified-bug|requirement-supplement|optimization> --reason <text> --evidence-ref <ref> --task-package-id <id> --summary <text> --target-window <window> --target-task-id <id> [--work-type <implementation|research|documentation|test> --objective <text> --context-summary <json> --requirement-refs <json> --boundaries <json> --completion-expectations <json> --depends-on-task-ids <json> --commit-expectation <commit|leave-uncommitted>] [--source-ref <ref>] [--design-intent <text>] [--acceptance-anchors <json>] [--evidence-contract <json>] [--write] [--json]
  node scripts/wakeflow-state.mjs cancel-demand --state-root <path> --reason <text> [--write] [--json]
  node scripts/wakeflow-state.mjs archive-demand --state-root <path> --reason <text> [--redact] [--allow-opaque] [--evidence-ref <ref>] [--write] [--json]
  node scripts/wakeflow-state.mjs sanitize-archive --state-root <archived-path> --reason <text> [--allow-opaque] [--write] [--json]
  node scripts/wakeflow-state.mjs adopt-demand-host --state-root <path> [--reason <text>] [--write] [--json]
  node scripts/wakeflow-state.mjs recover-state-transition --state-root <path> [--write] [--json]

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

function fail(message, options = {}) {
  output({
    ok: false,
    command,
    error: message,
    ...(options.status ? { status: options.status } : {}),
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
    ...(options.activeDemands ? { activeDemands: options.activeDemands } : {}),
    ...(options.placement ? { placement: options.placement } : {}),
    ...(options.mainlineHealth ? { mainlineHealth: options.mainlineHealth } : {}),
    ...(options.errorCode || options.retryable !== undefined || options.recovery
      ? {
          diagnostics: {
            code: options.errorCode || "wakeflow-state-error",
            severity: "error",
            plane: "state-machine",
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

// The evidenceContract field (persistent compatibility name) is the AUTHORITY
// SOURCE for the only hard craft review-input gate
// (craft-review-inputs-required). A malformed shape must fail intake here (fail-closed),
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

// A small controller-authored bridge between the confirmed requirement and the
// target's first RED checks. Anchors are behavior probes, not another test plan:
// each one must say what is claimed, how the target can challenge it, and what
// observable outcome the controller can independently validate against the claim.
function validateAcceptanceAnchorsShape(anchors) {
  if (anchors == null) return null;
  if (!Array.isArray(anchors) || anchors.length === 0) {
    fail("--acceptance-anchors must be a non-empty JSON array of {id, claim, probe, expected} entries.");
  }
  const seen = new Set();
  return anchors.map((anchor) => {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
      fail("--acceptance-anchors entries must be objects with non-empty id, claim, probe, and expected strings.");
    }
    const normalized = {};
    for (const field of ["id", "claim", "probe", "expected"]) {
      if (typeof anchor[field] !== "string" || !anchor[field].trim()) {
        fail("--acceptance-anchors entries must contain non-empty id, claim, probe, and expected strings.");
      }
      normalized[field] = anchor[field].trim();
    }
    if (seen.has(normalized.id)) {
      fail(`--acceptance-anchors entries must have a unique id; duplicate: ${normalized.id}.`);
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function parseTaskPackageContext(acceptanceAnchors) {
  const contextFlags = [
    "--work-type",
    "--objective",
    "--context-summary",
    "--requirement-refs",
    "--boundaries",
    "--completion-expectations",
    "--depends-on-task-ids",
    "--commit-expectation",
  ];
  const hasContextInput = contextFlags.some((flag) => (getValue(flag, "") || "").trim());
  if (!hasContextInput) return null;
  try {
    return normalizeTaskPackageContext({
      contextVersion: TASK_CONTEXT_VERSION,
      workType: getValue("--work-type"),
      objective: getValue("--objective"),
      contextSummary: parseOptionalJsonArg("--context-summary"),
      requirementRefs: parseOptionalJsonArg("--requirement-refs"),
      boundaries: parseOptionalJsonArg("--boundaries"),
      completionExpectations: parseOptionalJsonArg("--completion-expectations"),
      dependsOnTaskIds: parseOptionalJsonArg("--depends-on-task-ids") ?? [],
      commitExpectation: getValue("--commit-expectation"),
      acceptanceAnchors,
    });
  } catch (error) {
    fail(`invalid task package context: ${error.message}`);
  }
}

function validateTaskPackageContextForTarget({ taskContext, acceptanceAnchors, state, targetTaskId, testExecution }) {
  if (!taskContext) return;
  if (new Set(taskContext.dependsOnTaskIds).size !== taskContext.dependsOnTaskIds.length) {
    fail("--depends-on-task-ids must not contain duplicates.");
  }
  if (taskContext.dependsOnTaskIds.includes(targetTaskId)) {
    fail(`target task ${targetTaskId} cannot depend on itself.`);
  }
  for (const dependencyId of taskContext.dependsOnTaskIds) {
    if (!(state.targetTasks ?? []).some((task) => task.targetTaskId === dependencyId)) {
      fail(`dependency target task does not exist in controller state: ${dependencyId}`);
    }
  }
  if (taskContext.workType === "test" && !testExecution) {
    fail("workType=test requires an authoritative Test card / testExecution contract.");
  }
  if (taskContext.workType !== "test" && testExecution) {
    fail(`a Test task package must use workType=test, not ${taskContext.workType}.`);
  }
  if (taskContext.workType === "implementation" && (!acceptanceAnchors || acceptanceAnchors.length === 0)) {
    fail("implementation task packages require at least one controller-authored acceptanceAnchor.");
  }
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
  const openNonTestTasks = (state.targetTasks ?? []).filter((task) => {
    const windowName = task.targetWindow || "";
    const taskIsTest = windowName === configuredTestWindow || windowName.startsWith(`${configuredTestWindow}__`);
    return !taskIsTest && !["accepted", "superseded"].includes(task.status);
  });
  if (openNonTestTasks.length > 0) {
    const blockers = openNonTestTasks.map((task) => `${task.targetTaskId}:${task.status || "unknown"}`).join(", ");
    fail(`Test work cannot be packaged until total control accepts the demand's existing non-Test targets. Open targets: ${blockers}.`);
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

// Craft evidence entries are target-authored review inputs stored in the durable
// target-result artifact. Reject empty shapes at the door, but do not confuse
// structural validity with controller verification or acceptance.
function validateCraftEvidenceEntries(entries) {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.kind !== "string" || !entry.kind.trim()) {
      fail("--craft-evidence entries must be objects with a non-empty string kind (e.g. {\"kind\":\"tests\",\"ref\":\"...\"}).");
    }
    const reviewInputFields = ["ref", "value", "commit"];
    for (const field of reviewInputFields) {
      if (entry[field] !== undefined && (typeof entry[field] !== "string" || !entry[field].trim())) {
        fail(`--craft-evidence ${field} must be a non-empty string when provided.`);
      }
    }
    if (!reviewInputFields.some((field) => typeof entry[field] === "string" && entry[field].trim())) {
      fail("--craft-evidence entries must carry a reviewable input in at least one of ref, value, or commit; kind alone is not review material.");
    }
    if (entry.verify !== undefined && (typeof entry.verify !== "string" || !entry.verify.trim())) {
      fail("--craft-evidence verify must be a non-empty string when provided.");
    }
    for (const field of ["anchorId", "red", "green", "step"]) {
      if (entry[field] !== undefined && (typeof entry[field] !== "string" || !entry[field].trim())) {
        fail(`--craft-evidence ${field} must be a non-empty string when provided.`);
      }
    }
    if (entry.planIndex !== undefined && (!Number.isInteger(entry.planIndex) || entry.planIndex < 0)) {
      fail("--craft-evidence planIndex must be a non-negative integer when provided.");
    }
  }
  return entries;
}

function craftEvidenceHasReviewInput(entry) {
  return ["ref", "value", "commit"].some(
    (field) => typeof entry?.[field] === "string" && entry[field].trim(),
  );
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
      assertPodHostTransferAllowed(state);
      state.controllerHost = currentHost;
      return { controllerHost: currentHost, transferredFrom: owner };
    }
    fail(`demand ${state.demandKey} is owned by controller host ${owner}; this runtime is ${currentHost}. Continue on the ${owner} controller, or transfer ownership explicitly with adopt-demand-host (MCP: wakeflow_adopt_demand_host), or pass --adopt-host on a state-writing command.`);
  }
  return { controllerHost: owner };
}

function assertPodHostTransferAllowed(state) {
  const explicitPod = (
    state.executionPlacement?.mode === "isolated"
    && state.executionPlacement?.selection === "explicit-user-pod"
  );
  const phase = state.podProvisioning?.phase ?? null;
  if (explicitPod && phase && phase !== "closed") {
    fail(
      `demand ${state.demandKey} has an active Pod lifecycle in phase ${phase} on host `
      + `${state.podProvisioning?.host || state.controllerHost || "unknown"}; close or cancel that Pod on its owning host before transferring controller ownership.`,
    );
  }
}

function commandAdoptDemandHost() {
  const stateRoot = stateRootFromArg();
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
  // The first host claim is not a transfer. An explicitly authorized Pod is
  // initialized host-neutral, so its creator must be able to claim it once
  // even though provisioning has already entered creating-control. Only an
  // existing owner moving to another host is blocked by the active-Pod gate.
  if (previousOwner) assertPodHostTransferAllowed(state);
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
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      command: "adopt-demand-host",
    });
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

function mergeRedactedFields(...fieldLists) {
  const merged = new Map();
  for (const field of fieldLists.flat()) {
    const current = merged.get(field.file) ?? { file: field.file, count: 0, kinds: {} };
    current.count += Number(field.count ?? 0);
    for (const [kind, count] of Object.entries(field.kinds ?? {})) {
      current.kinds[kind] = (current.kinds[kind] ?? 0) + Number(count ?? 0);
    }
    merged.set(field.file, current);
  }
  return [...merged.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function mergeOpaquePlaceholders(...placeholderLists) {
  const merged = new Map();
  for (const placeholder of placeholderLists.flat()) {
    if (!placeholder?.originalFile || !placeholder?.placeholderFile) continue;
    merged.set(`${placeholder.originalFile}\0${placeholder.placeholderFile}`, placeholder);
  }
  return [...merged.values()].sort((a, b) => (
    a.originalFile.localeCompare(b.originalFile)
    || a.placeholderFile.localeCompare(b.placeholderFile)
  ));
}

function mergePathPlaceholders(...placeholderLists) {
  const merged = new Map();
  for (const placeholder of placeholderLists.flat()) {
    if (!placeholder?.portablePath || !placeholder?.placeholderFile) continue;
    merged.set(`${placeholder.portablePath}\0${placeholder.placeholderFile}`, placeholder);
  }
  return [...merged.values()].sort((a, b) => (
    a.portablePath.localeCompare(b.portablePath)
    || a.placeholderFile.localeCompare(b.placeholderFile)
  ));
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
    ledgerPaths.workspaceCurrentDir,
    ledgerPaths.workspaceArchiveDir,
  ]);
  if (!existsSync(path.join(stateRoot, "wakeflow-state.json"))) {
    fail(`state root is missing wakeflow-state.json: ${relative(stateRoot)}`);
  }
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

function appendJsonLine(file, value) {
  // Append-mode (O_APPEND) so concurrent writers cannot drop each other's
  // lines, matching the delivery-store implementation.
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}

function assertDemandWritable(state, operation, stateRoot) {
  if (state?.state !== "archived") return;
  if (operation === "sanitize-archive") return;
  if (
    operation === "archive-demand"
    && stateRoot
    && existsSync(path.join(stateRoot, "wakeflow-archive.pending-intent.json"))
  ) {
    return;
  }
  fail(`cannot run ${operation} while demand is archived: ${state?.demandKey ?? relative(stateRoot)}. Archived demand history is immutable; only sanitize-archive or an already-journaled archive finalization may write it.`);
}

// Cross-process mutex for every state-root read-modify-write command. Parallel MCP
// calls from one controller turn (e.g. two add-task-package) otherwise both read
// revision N and the second write silently drops the first. The state readJson must
// happen INSIDE fn so the whole read-modify-write is one critical section.
function withLockedStateRoot(stateRoot, fn) {
  try {
    return withStateRootLock(stateRoot, () => {
      const stateFile = path.join(stateRoot, "wakeflow-state.json");
      const eventsFile = path.join(stateRoot, "controller-events.jsonl");
      const state = readJson(stateFile, "controller state");
      assertDemandWritable(state, command, stateRoot);
      let events;
      try {
        events = readControllerEventsStrict(eventsFile);
      } catch (error) {
        if (error instanceof WakeflowControllerEventLogError) {
          fail(
            `${error.message} (${relative(eventsFile)}). Repair the controller event log before running ${command}; state was not changed.`,
            {
              errorCode: "delivery-event-log-repair-required",
              retryable: true,
              recovery: {
                strategy: "repair-event-log-then-retry",
                stateRoot: relative(stateRoot),
                eventsFile: relative(eventsFile),
                stateRevision: state.revision,
                lineNumber: error.lineNumber,
                command,
              },
            },
          );
        }
        throw error;
      }
      let pendingRecovery = { status: "none" };
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
            `${error.message}. Inspect ${relative(stateRoot)} before running ${command}; state was not changed.`,
            {
              errorCode: "controller-event-manual-recovery-required",
              retryable: false,
              recovery: {
                strategy: "inspect-state-event-transition-journal",
                stateRoot: relative(stateRoot),
                eventsFile: relative(eventsFile),
                stateRevision: state.revision,
                command,
                ...(error.details?.currentRevision !== undefined
                  ? { currentRevision: error.details.currentRevision }
                  : {}),
                ...(error.details?.targetRevision !== undefined
                  ? { targetRevision: error.details.targetRevision }
                  : {}),
                ...(error.details?.eventId ? { eventId: error.details.eventId } : {}),
                ...(error.details?.conflictingEventId
                  ? { conflictingEventId: error.details.conflictingEventId }
                  : {}),
                ...(error.details?.conflictingRevision !== undefined
                  ? { conflictingRevision: error.details.conflictingRevision }
                  : {}),
              },
            },
          );
        }
        throw error;
      }
      if (pendingRecovery.status !== "none") {
        fail(
          `pending controller transition ${pendingRecovery.eventId ?? "(unknown)"} must be recovered explicitly before running ${command}; state was not changed.`,
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
              command,
            },
          },
        );
      }
      const alignment = controllerEventStateAlignment(events, state.revision);
      if (alignment.status === "event-ahead") {
        const firstReserved = futureControllerEvents(events, state.revision)[0]
          ?? alignment.latestEvent;
        const reservedRun = firstReserved.wakeflowTrace?.deliveryRunId;
        const deliveryRecovery = Boolean(reservedRun);
        fail(
          `controller event revision ${firstReserved.stateRevision} is reserved ahead of state revision ${state.revision}; ${reservedRun ? `replay delivery run ${reservedRun}` : "no matching transition journal exists, so manual recovery is required"} before running ${command}. State was not changed.`,
          {
            errorCode: deliveryRecovery
              ? "delivery-state-recovery-required"
              : "controller-event-manual-recovery-required",
            retryable: deliveryRecovery,
            recovery: {
              strategy: reservedRun
                ? "replay-reserved-delivery-run-first"
                : "inspect-state-event-transition-journal",
              stateRoot: relative(stateRoot),
              eventsFile: relative(eventsFile),
              stateRevision: state.revision,
              reservedRevision: firstReserved.stateRevision,
              reservedDeliveryRunId: reservedRun,
              command,
            },
          },
        );
      }
      if (alignment.status === "state-ahead") {
        fail(
          `controller state revision ${state.revision} is ahead of the event log revision ${alignment.latestEventRevision}; no matching transition journal exists, so manual recovery is required before running ${command}. State was not changed.`,
          {
            errorCode: "controller-event-manual-recovery-required",
            retryable: false,
            recovery: {
              strategy: "inspect-state-event-transition-journal",
              stateRoot: relative(stateRoot),
              eventsFile: relative(eventsFile),
              stateRevision: state.revision,
              latestEventRevision: alignment.latestEventRevision,
              command,
            },
          },
        );
      }
      try {
        return fn();
      } catch (error) {
        if (error instanceof CliExit) throw error;
        let pending = null;
        try {
          pending = readPendingStateTransition(stateRoot);
        } catch {
          // The original error remains primary when the journal itself cannot
          // be inspected. The next read-only status pass will report both
          // authority artifacts without guessing.
        }
        if (pending) {
          fail(
            `state transition ${pending.event?.eventId ?? "(unknown)"} was journaled but did not finish while running ${command}: ${error.message}`,
            {
              errorCode: "state-transition-recovery-required",
              retryable: true,
              recovery: {
                strategy: "run-recover-state-transition",
                stateRoot: relative(stateRoot),
                eventsFile: relative(eventsFile),
                stateRevision: state.revision,
                reservedRevision: pending.nextState?.revision,
                eventId: pending.event?.eventId,
                reason: "journaled-transition-write-failed",
                command,
              },
            },
          );
        }
        throw error;
      }
    }, {
      onWarn: (message) => process.stderr.write(`wakeflow-state: ${message}\n`),
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function commandRecoverStateTransition() {
  const stateRoot = stateRootFromArg();
  try {
    withStateRootLock(stateRoot, () => {
      const stateFile = path.join(stateRoot, "wakeflow-state.json");
      const eventsFile = path.join(stateRoot, "controller-events.jsonl");
      const state = readJson(stateFile, "controller state");
      assertDemandWritable(state, "recover-state-transition", stateRoot);
      let events;
      try {
        events = readControllerEventsStrict(eventsFile);
      } catch (error) {
        if (error instanceof WakeflowControllerEventLogError) {
          fail(
            `${error.message} (${relative(eventsFile)}). Repair the controller event log before recovering the pending transition; state was not changed.`,
            {
              errorCode: "delivery-event-log-repair-required",
              retryable: true,
              recovery: {
                strategy: "repair-event-log-then-recover",
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
      let pending;
      try {
        pending = readPendingStateTransition(stateRoot);
      } catch (error) {
        if (error instanceof WakeflowPendingTransitionError) {
          failPendingStateTransition(error, stateRoot, eventsFile, state.revision);
        }
        throw error;
      }
      if (!pending) {
        const alignment = controllerEventStateAlignment(events, state.revision);
        if (alignment.status !== "aligned") {
          fail(
            `no pending transition journal exists and state/event revisions are not aligned (${state.revision}/${alignment.latestEventRevision}); manual recovery is required.`,
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
        output({
          ok: true,
          command: "recover-state-transition",
          wrote: false,
          stateRoot: relative(stateRoot),
          stateRevision: state.revision,
          note: "no pending transition exists; state and event log are already aligned",
        });
        return;
      }

      authorizePendingTransitionRecovery(state, pending);
      let recovery;
      try {
        recovery = recoverPendingStateTransition({
          stateRoot,
          state,
          events,
          write,
        });
      } catch (error) {
        if (error instanceof WakeflowPendingTransitionError) {
          failPendingStateTransition(error, stateRoot, eventsFile, state.revision);
        }
        throw error;
      }
      if (!write) {
        output({
          ok: true,
          command: "recover-state-transition",
          wrote: false,
          stateRoot: relative(stateRoot),
          pendingEventId: recovery.eventId ?? pending.event?.eventId ?? null,
          currentRevision: state.revision,
          targetRevision: recovery.targetRevision ?? pending.nextState?.revision ?? null,
          recoveryStatus: recovery.status,
          agentNext: "Dry-run only. Re-run wakeflow_recover_state_transition with apply=true to complete this exact journaled transition.",
        });
        return;
      }
      const recoveredState = readJson(stateFile, "controller state");
      const recoveredEvents = readControllerEventsStrict(eventsFile);
      const alignment = controllerEventStateAlignment(recoveredEvents, recoveredState.revision);
      if (alignment.status !== "aligned") {
        fail(
          `pending transition recovery finished but state/event revisions remain misaligned (${recoveredState.revision}/${alignment.latestEventRevision}); stop for manual inspection.`,
          {
            errorCode: "controller-event-manual-recovery-required",
            retryable: false,
            recovery: {
              strategy: "inspect-state-event-transition-journal",
              stateRoot: relative(stateRoot),
              eventsFile: relative(eventsFile),
              stateRevision: recoveredState.revision,
              latestEventRevision: alignment.latestEventRevision,
            },
          },
        );
      }
      output({
        ok: true,
        command: "recover-state-transition",
        wrote: true,
        stateRoot: relative(stateRoot),
        recoveredEventId: recovery.eventId ?? pending.event?.eventId ?? null,
        stateRevision: recoveredState.revision,
        recoveryStatus: recovery.status,
        agentNext: "The exact journaled transition is recovered. Re-run the original controller command only if it is still required.",
      });
    }, {
      onWarn: (message) => process.stderr.write(`wakeflow-state: ${message}\n`),
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
  }
}

function authorizePendingTransitionRecovery(state, pending) {
  const currentHost = hostProfile.runtime.hostDirName;
  const currentOwner = state.controllerHost ?? null;
  const pendingOwner = pending.nextState?.controllerHost ?? null;
  if (pending.command === "adopt-demand-host") {
    const validHostAdoption = ["demand.host-adopted", "demand.host-transferred"]
      .includes(pending.event?.type)
      && pending.event?.to === currentHost
      && pendingOwner === currentHost;
    if (!validHostAdoption) {
      fail(`pending host adoption belongs to ${pendingOwner ?? "(missing owner)"}; this runtime is ${currentHost} and cannot recover it.`);
    }
    return;
  }
  if (currentOwner && currentOwner !== currentHost) {
    fail(`demand ${state.demandKey} is owned by controller host ${currentOwner}; this runtime is ${currentHost} and cannot recover its pending transition.`);
  }
  if (pendingOwner && pendingOwner !== currentHost) {
    fail(`pending transition assigns controller host ${pendingOwner}; this runtime is ${currentHost} and cannot recover it.`);
  }
}

function failPendingStateTransition(error, stateRoot, eventsFile, stateRevision) {
  fail(
    `${error.message}. Inspect ${relative(stateRoot)}; state was not changed.`,
    {
      errorCode: "controller-event-manual-recovery-required",
      retryable: false,
      recovery: {
        strategy: "inspect-state-event-transition-journal",
        stateRoot: relative(stateRoot),
        eventsFile: relative(eventsFile),
        stateRevision,
        ...(error.details?.currentRevision !== undefined
          ? { currentRevision: error.details.currentRevision }
          : {}),
        ...(error.details?.targetRevision !== undefined
          ? { targetRevision: error.details.targetRevision }
          : {}),
        ...(error.details?.eventId ? { eventId: error.details.eventId } : {}),
      },
    },
  );
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

function knownDispatchGroupsForTargetTask(targetWindow, targetTaskId, stateRoot, demandKey) {
  const groups = new Set();
  const packetDir = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  if (existsSync(packetDir)) {
    for (const name of readdirSync(packetDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const packet = JSON.parse(readFileSync(path.join(packetDir, name), "utf8"));
        if (
          packet.targetWindow === targetWindow
          && (packet.taskId === targetTaskId
            || packet.targetTaskId === targetTaskId
            || packet.stateRef?.targetTaskId === targetTaskId)
          && typeof packet.stateRef?.stateRoot === "string"
          && path.resolve(workspaceRoot, packet.stateRef.stateRoot) === path.resolve(stateRoot)
          && (!packet.stateRef?.demandKey || packet.stateRef.demandKey === demandKey)
          && typeof packet.dispatchGroup === "string"
          && packet.dispatchGroup
        ) {
          groups.add(packet.dispatchGroup);
        }
      } catch {
        // A malformed transport artifact is handled by delivery diagnostics;
        // it cannot authorize an otherwise unknown result group.
      }
    }
  }
  for (const item of [
    ...readStateRootTargetResultItems(stateRoot, readJson),
    ...readTargetResultHistory(stateRoot),
  ]) {
    const result = item.result;
    if (
      (result?.targetTaskId || result?.taskId) === targetTaskId
      && result?.targetWindow === targetWindow
      && typeof result?.dispatchGroup === "string"
      && result.dispatchGroup
    ) {
      groups.add(result.dispatchGroup);
    }
  }
  return [...groups];
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
  return direct ?? null;
}

function evidenceWorkRootForTarget(stateRoot, state, targetWindow) {
  try {
    return resolvePodTargetWorkRoot({
      workspaceRoot,
      stateDir: path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery"),
      host: hostProfile.hostId || hostProfile.runtime.hostDirName,
      stateRoot,
      state,
      targetWindow,
    });
  } catch (error) {
    fail(error.message);
  }
  return null;
}

function evidenceRefResolutionCandidates(stateRoot, state, ref, targetWindow, podTarget = null) {
  const text = String(ref ?? "");
  if (!evidenceRefLooksLikePath(text)) return [];
  const podContext = podTarget ?? evidenceWorkRootForTarget(stateRoot, state, targetWindow);
  if (path.isAbsolute(text)) return [path.resolve(text)];
  // Pod evidence is either copied into the canonical state root or remains
  // relative to the exact verified host worktree. It must never resolve from
  // the configured main checkout or the parent workspace.
  const roots = podContext?.isPod
    ? [stateRoot, podContext.actualCwd]
    : [stateRoot, evidenceRepoRootForWindow(targetWindow), workspaceRoot];
  return roots
    .filter(Boolean)
    .map((root) => path.resolve(root, text));
}

function missingEvidenceRefsForTargetResult(stateRoot, state, task, result, podTarget) {
  const refs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
  return refs
    .map((ref) => {
      const candidates = evidenceRefResolutionCandidates(
        stateRoot,
        state,
        ref,
        task.targetWindow,
        podTarget,
      );
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

// W-Target execution-craft gate: a COMPLETED target result must provide the review
// inputs declared by its task package — each `required` kind is present in
// craftEvidence and each declared artifact path resolves on disk. This verifies
// structure and locatability only; the controller still validates truth and quality.
// Absent contract => no gap. Only completed results are enforced: blocked /
// needs-review honestly report an incomplete task and must never be wedged by the
// contract.
function craftEvidenceGapsForTargetResult(stateRoot, state, task, result, podTarget) {
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
    const reviewableEntries = entries.filter(craftEvidenceHasReviewInput);
    if (reviewableEntries.length === 0) {
      gaps.push({ ...base, reason: "missing-review-input" });
      continue;
    }
    for (const entry of reviewableEntries) {
      const ref = typeof entry?.ref === "string" ? entry.ref : "";
      if (!ref) continue;
      const candidates = evidenceRefResolutionCandidates(
        stateRoot,
        state,
        ref,
        task.targetWindow,
        podTarget,
      );
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

function unifiedStatusText({ demandKey, title, state, updatedAt, revision, eventId, language, decisionsRequired = null }) {
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
    decisionsRequired: decisionsRequired ?? locale.none,
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
  const demandType = String(getValue("--demand-type", "") || "").trim() || null;
  if (demandType && !DEMAND_TYPES.includes(demandType)) {
    fail(`--demand-type must be one of: ${DEMAND_TYPES.join(", ")}.`);
  }
  const demandAuthorityInput = parseOptionalJsonArg("--demand-authority");
  const requireMainlineHealth = hasFlag("--require-mainline-health");
  let config;
  try {
    config = loadWorkspaceConfig({ workspaceRoot, args: options });
  } catch (error) {
    if (requireMainlineHealth) {
      fail(`mainline is unavailable for ${demandKey}: Wakeflow workspace config is unreadable.`, {
        status: "blocked",
        errorCode: "mainline-unavailable",
        retryable: true,
        placement: { requested: "main", selection: "mainline-default" },
        mainlineHealth: {
          available: false,
          requiredWindows: [],
          windows: [],
          issues: [{
            code: "workspace-config-unreadable",
            message: String(error?.message ?? error).replace(/\s+/g, " "),
          }],
        },
        recovery: "Repair wakeflow.config.json or its derived local configuration, then retry mainline demand creation. Wakeflow will not create a Pod automatically.",
      });
    }
    throw error;
  }
  const language = selectInterfaceLanguage(config);
  const locale = wakeflowStateLocale(language);
  const goal = getValue("--goal", locale.defaultGoal);
  const requestedPlacement = String(getValue("--placement", "main") || "main").trim().toLowerCase();
  const authorizationRef = String(getValue("--authorization-ref", "") || "").trim() || null;
  const requestedPodId = String(getValue("--pod-id", "") || "").trim() || null;
  if (!["main", "pod"].includes(requestedPlacement)) {
    fail(`--placement must be main or pod, got ${requestedPlacement || "(empty)"}.`);
  }
  if (requestedPlacement === "pod" && !authorizationRef) {
    fail("--authorization-ref is required when --placement pod is explicitly requested.");
  }
  if (requestedPlacement === "main" && (authorizationRef || requestedPodId)) {
    fail("--authorization-ref and --pod-id are valid only with --placement pod.");
  }
  // The demand's OWN controller window (demand pods: Controller__<pod>). Every
  // dispatch's controller-return defaults to this, so a pod controller never
  // mis-routes wake-ups to the workspace-level controller by forgetting a flag.
  const explicitControllerWindow = (getValue("--controller-window", "") || "").trim();
  const configuredControllerWindow = (config.controllerWindow || "").trim();
  let demandControllerWindow = explicitControllerWindow || configuredControllerWindow || null;
  let executionPlacement = null;
  const completionDefinition = getValue("--completion-definition", locale.defaultCompletionDefinition);
  // Legacy display projection only. New typed demand readiness is derived from
  // demand-authority.json; this string remains for older roots and progress prose.
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
  const configuredCurrentDir = path.resolve(ledgerPaths.workspaceCurrentDir);
  if (path.dirname(stateRoot) !== configuredCurrentDir) {
    fail(
      `state root must stay inside the Wakeflow runtime or configured project ledger; new demand state roots must be direct children of the configured workspaceCurrentDir (${relative(configuredCurrentDir)}), but got ${relative(stateRoot)}. Archive/ledger roots are created only by archive-demand.`,
    );
  }
  if (isWakeflowInitStagingEntry(path.basename(stateRoot))) {
    fail(`state root basename ${path.basename(stateRoot)} uses the reserved .wakeflow-init- staging namespace.`);
  }
  let demandAuthority = null;
  let demandAuthorityReadiness = null;
  if (demandAuthorityInput) {
    try {
      demandAuthorityReadiness = assertDemandAuthorityReady(demandAuthorityInput, {
        workspaceRoot,
        demandKey,
        demandType,
        entryMode: requestedPlacement === "pod"
          ? "pod-design"
          : designKey
            ? "design-delivery"
            : "controller-inline",
      });
      demandAuthority = demandAuthorityReadiness.authority;
    } catch (error) {
      fail(error.message);
    }
    if (demandAuthority.demandKey !== demandKey) {
      fail(`demandAuthority.demandKey must equal ${demandKey}.`);
    }
    if (demandType && demandAuthority.demandType !== demandType) {
      fail(`--demand-type ${demandType} does not match demandAuthority.demandType ${demandAuthority.demandType}.`);
    }
  }
  const effectiveDemandType = demandAuthority?.demandType ?? demandType;

  const createdAt = nowIso();
  const eventId = `evt-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-0001`;
  const progressDoc = "developer-progress.md";
  const files = {
    demand: path.join(stateRoot, "demand.json"),
    authority: path.join(stateRoot, DEMAND_AUTHORITY_FILE),
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
    ...(effectiveDemandType ? { demandType: effectiveDemandType } : {}),
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
    ...(effectiveDemandType ? { demandType: effectiveDemandType } : {}),
    ...(demandAuthority ? {
      demandAuthorityRef: DEMAND_AUTHORITY_FILE,
      demandAuthorityDigest: demandAuthorityReadiness.digest,
    } : {}),
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
      ...(demandAuthority ? [DEMAND_AUTHORITY_FILE] : []),
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
  const authorityPendingDecision = demandAuthority ? null : {
    id: "demand-authority-not-frozen",
    summary: locale.authorityPendingDecision,
    source: "projection",
  };
  const unifiedStatus = unifiedStatusText({
    demandKey,
    title,
    state: state.state,
    updatedAt: createdAt,
    revision: state.revision,
    eventId,
    language,
    decisionsRequired: authorityPendingDecision?.summary ?? locale.none,
  });
  const projection = {
    schemaVersion,
    demandKey,
    title,
    interfaceLanguage: language,
    sourceRevision: state.revision,
    sourceEventId: eventId,
    progressDoc,
    demandAuthority: demandAuthority ? {
      status: demandAuthorityProjectionStatus(state),
      ref: DEMAND_AUTHORITY_FILE,
      digest: demandAuthorityReadiness.digest,
      demandType: demandAuthority.demandType,
      entryMode: demandAuthority.entryMode,
      testDecision: demandAuthority.testDecision,
      authorityRefs: demandAuthority.authorityRefs,
    } : {
      status: demandAuthorityProjectionStatus(state),
      ref: null,
      digest: null,
    },
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
      userDecisionsNeeded: authorityPendingDecision?.summary ?? locale.none,
      lastUpdated: createdAt,
    },
    slices: {
      windows: [],
      taskPackages: [],
      targetTasks: [],
      blockers: [],
      decisionsRequired: authorityPendingDecision ? [authorityPendingDecision] : [],
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
    ...(demandAuthority ? [files.authority] : []),
    files.state,
    files.events,
    files.projection,
    files.progress,
  ];

  // Demand identity and mainline placement are CROSS-root invariants. Serialize
  // the scan and publication so concurrent creators cannot duplicate an
  // identity or both claim the one main checkout. Explicit pods are not
  // numerically capped; their authorization is carried by the init request.
  mkdirSync(path.dirname(ledgerPaths.workspaceCurrentDir), { recursive: true });
  try {
    withFileLock(`${ledgerPaths.workspaceCurrentDir}.identity-lock`, () => {
      let existingStateRoot = null;
      try {
        existingStateRoot = lstatSync(stateRoot);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          fail(`cannot inspect state root ${relative(stateRoot)} before initialization: ${error.message}`);
        }
      }
      if (existingStateRoot) {
        fail(`state root already exists at ${relative(stateRoot)}; refuse to re-initialize ${demandKey} or adopt crash residue.`);
      }
      const activeDemands = scanUnarchivedDemandStateRoots({
        workspaceRoot,
        currentDir: ledgerPaths.workspaceCurrentDir,
      });
      const duplicateDemand = activeDemands.find((item) => item.demandKey === demandKey);
      if (duplicateDemand) {
        fail(`cannot initialize duplicate demand key ${demandKey}: an unarchived state root already exists at ${duplicateDemand.stateRoot}. Resume or archive that root instead of creating a second identity.`);
      }
      const placementSummary = activeDemandPlacementSummary(activeDemands);
      if (!placementSummary.authoritySafe) {
        fail(
          `cannot initialize ${demandKey}: active demand authority is unreadable: ${activeDemandConflictSummary(placementSummary.unreadable)}.`,
          {
            errorCode: "active-demand-authority-unreadable",
            retryable: false,
            activeDemands,
            recovery: "Repair or archive the unreadable active demand root before creating another demand.",
          },
        );
      }
      if (requestedPlacement === "main" && placementSummary.mainlineBusy) {
        fail(
          `mainline is busy for ${demandKey}: ${activeDemandConflictSummary(placementSummary.mainline)}.`,
          {
            status: "waiting",
            errorCode: "mainline-busy",
            retryable: true,
            activeDemands,
            placement: { requested: "main", selection: "mainline-default" },
            recovery: "Continue the active mainline demand, wait until it is archived, or retry only after the user explicitly authorizes an isolated pod.",
          },
        );
      }
      if (requestedPlacement === "main" && requireMainlineHealth) {
        const mainlineHealth = inspectMainlineHealth({
          workspaceRoot,
          args: options,
          config,
          requiredProductWindows: valuesFor("--required-mainline-window"),
          ignoredCreateIntentFile: getValue("--ignore-create-intent-file", null),
        });
        if (!mainlineHealth.available) {
          fail(
            `mainline is unavailable for ${demandKey}: ${mainlineHealth.issues.map((item) => item.message).join("; ")}`,
            {
              status: "blocked",
              errorCode: "mainline-unavailable",
              retryable: true,
              placement: { requested: "main", selection: "mainline-default" },
              mainlineHealth,
              recovery: "Restore or replace the reported mainline windows/configuration and resolve recovery residue, then retry. Wakeflow will not create a Pod automatically.",
            },
          );
        }
      }
      executionPlacement = requestedPlacement === "pod"
        ? {
            mode: "isolated",
            podId: slug(requestedPodId ?? demandKey),
            selection: "explicit-user-pod",
            authorizationRef,
          }
        : {
            mode: "main",
            podId: null,
            selection: "mainline-default",
            authorizationRef: null,
          };
      if (requestedPlacement === "pod" && !explicitControllerWindow) {
        demandControllerWindow = `Controller__${executionPlacement.podId}`;
      }
      if (
        requestedPlacement === "pod"
        && explicitControllerWindow
        && explicitControllerWindow !== `Controller__${executionPlacement.podId}`
      ) {
        fail(`pod ${executionPlacement.podId} requires controller window Controller__${executionPlacement.podId}, not ${explicitControllerWindow}.`);
      }
      demand.executionPlacement = executionPlacement;
      state.executionPlacement = executionPlacement;
      if (requestedPlacement === "pod") {
        state.podProvisioning = {
          phase: "creating-control",
          podId: executionPlacement.podId,
          authorizationRef,
        };
      }
      state.controllerWindow = demandControllerWindow;
      if (write) {
        // A demand becomes visible only once all five initial artifacts exist.
        // The reserved hidden staging root stays outside active-demand scans;
        // the final same-filesystem directory rename is the publication point.
        mkdirSync(configuredCurrentDir, { recursive: true });
        let stagingRoot;
        for (let attempt = 0; ; attempt += 1) {
          const suffix = attempt ? `-${attempt}` : "";
          const candidate = path.join(
            configuredCurrentDir,
            `.wakeflow-init-${slug(demandKey)}-${process.pid}-${Date.now()}${suffix}`,
          );
          try {
            lstatSync(candidate);
          } catch (error) {
            if (error?.code === "ENOENT") {
              stagingRoot = candidate;
              break;
            }
            fail(`cannot inspect initialization staging root ${relative(candidate)}: ${error.message}`);
          }
        }
        const stagingFiles = Object.fromEntries(
          Object.entries(files).map(([key, file]) => [key, path.join(stagingRoot, path.basename(file))]),
        );
        try {
          mkdirSync(stagingRoot);
          writeJson(stagingFiles.demand, demand);
          if (demandAuthority) writeJson(stagingFiles.authority, demandAuthority);
          writeJson(stagingFiles.state, state);
          writeText(stagingFiles.events, JSON.stringify(event));
          writeJson(stagingFiles.projection, projection);
          writeText(stagingFiles.progress, progress);
          let stateRootAppeared = false;
          try {
            lstatSync(stateRoot);
            stateRootAppeared = true;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          if (stateRootAppeared) {
            fail(`state root appeared during initialization at ${relative(stateRoot)}; refuse to overwrite it.`);
          }
          renameSync(stagingRoot, stateRoot);
        } catch (error) {
          if (stagingRoot && existsSync(stagingRoot)) {
            rmSync(stagingRoot, { recursive: true, force: true });
          }
          throw error;
        }
      }
    });
  } catch (error) {
    if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
    throw error;
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
      ...(demandAuthority ? {
        demandAuthorityFile: relative(files.authority),
        demandAuthorityDigest: demandAuthorityReadiness.digest,
        demandType: demandAuthority.demandType,
      } : effectiveDemandType ? { demandType: effectiveDemandType } : {}),
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
  // Design-authored execution-craft review-input contract (W-Target; persistent field name). Optional JSON
  // { version, required:[{kind,verify}], advisory:[{kind}] }; kept OUT of the dispatch
  // idempotency comparable (like designIntent) so it can be authored/adjusted without
  // breaking replay. Absent = zero behavior change.
  const evidenceContract = validateEvidenceContractShape(parseOptionalJsonArg("--evidence-contract"));
  const acceptanceAnchors = validateAcceptanceAnchorsShape(parseOptionalJsonArg("--acceptance-anchors"));
  const taskContext = parseTaskPackageContext(acceptanceAnchors);
  const demandAuthorityInput = parseOptionalJsonArg("--demand-authority");
  const targetWindow = getValue("--target-window", null);
  const targetTaskId = getValue("--target-task-id", targetWindow ? `${taskPackageId}__${slug(targetWindow)}` : null);
  const replacesTargetTaskId = (getValue("--replaces-target-task-id", "") || "").trim() || null;
  const targetSummary = getValue("--target-summary", summary);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const packageFile = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  const state = readJson(stateFile, "controller state");
  const demandFile = path.join(stateRoot, "demand.json");
  const demand = readJson(demandFile, "demand identity");
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
  if (reworkRouteActive && !replacesTargetTaskId) {
    fail(`cannot add task package while rework route is active; ordinary rework must re-dispatch the original task, while redesign must use an explicit replacesTargetTaskId.`);
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
  if (targetTaskId && !targetWindow) {
    fail("--target-window is required when --target-task-id is provided.");
  }
  if (targetTaskId && (state.targetTasks ?? []).some((item) => item.targetTaskId === targetTaskId)) {
    fail(`controller state already contains target task: ${targetTaskId}`);
  }
  if (replacesTargetTaskId && !targetTaskId) {
    fail("--replaces-target-task-id requires a target task.");
  }
  if (replacesTargetTaskId === targetTaskId) {
    fail("a redesign replacement cannot replace itself.");
  }
  const replacedTargetTask = replacesTargetTaskId
    ? (state.targetTasks ?? []).find((item) => item.targetTaskId === replacesTargetTaskId)
    : null;
  if (replacesTargetTaskId && !replacedTargetTask) {
    fail(`redesign replacement target task does not exist: ${replacesTargetTaskId}`);
  }
  if (
    replacedTargetTask
    && (
      replacedTargetTask.status !== "needs-rework"
      || replacedTargetTask.reviewDecision !== "redesign"
    )
  ) {
    fail(`--replaces-target-task-id requires a task parked by a redesign decision; ${replacesTargetTaskId} is ${replacedTargetTask.status || "unknown"}/${replacedTargetTask.reviewDecision || "undecided"}.`);
  }
  if (replacedTargetTask?.replacedByTargetTaskId) {
    fail(`redesign task ${replacesTargetTaskId} is already replaced by ${replacedTargetTask.replacedByTargetTaskId}.`);
  }
  if (replacedTargetTask && taskContext?.workType !== "implementation") {
    fail("a redesign replacement must be a full-context implementation task package; Design handoff remains stateless and research, documentation, Test, or legacy packages cannot supersede product work.");
  }
  if (replacedTargetTask) {
    const config = loadWorkspaceConfig({ workspaceRoot, args: options });
    const baseTargetWindow = targetWindow.split("__", 1)[0];
    const baseReplacedWindow = String(replacedTargetTask.targetWindow ?? "").split("__", 1)[0];
    const specialWindows = new Set([
      config.controllerWindow,
      config.designWindow,
      config.realProjectWindow,
      ...testWindowNames(config),
    ].filter(Boolean));
    const productWindows = new Set(config.repoNames ?? []);
    if (!productWindows.has(baseReplacedWindow) || specialWindows.has(baseReplacedWindow)) {
      fail(`a redesign replacement can only replace work owned by a product responsibility window; ${replacesTargetTaskId} belongs to ${baseReplacedWindow || "(unknown)"}.`);
    }
    if (!productWindows.has(baseTargetWindow) || specialWindows.has(baseTargetWindow)) {
      fail(`a redesign replacement must target a product responsibility window, not ${baseTargetWindow}.`);
    }
  }
  const testExecution = targetWindow
    ? testExecutionForNewTask({ stateRoot, state, targetWindow, targetTaskId })
    : null;
  validateTaskPackageContextForTarget({
    taskContext,
    acceptanceAnchors,
    state,
    targetTaskId,
    testExecution,
  });
  for (const requirementRef of taskContext?.requirementRefs ?? []) {
    const issue = requirementRefIssue(workspaceRoot, requirementRef);
    if (issue) {
      fail(`invalid task package context: ${issue}`);
    }
  }
  if (state.demandAuthorityRef && state.demandAuthorityRef !== DEMAND_AUTHORITY_FILE) {
    fail(`controller state demandAuthorityRef must equal ${DEMAND_AUTHORITY_FILE}.`);
  }
  if (state.demandAuthorityRef && !state.demandAuthorityDigest) {
    fail(`controller state is missing the frozen demandAuthorityDigest for ${DEMAND_AUTHORITY_FILE}.`);
  }
  const authorityFile = path.join(stateRoot, DEMAND_AUTHORITY_FILE);
  if (!state.demandAuthorityRef && existsSync(authorityFile)) {
    fail(`unreferenced ${DEMAND_AUTHORITY_FILE} already exists; refuse to overwrite ambiguous demand authority. Reconcile the state root before adding work.`);
  }
  if (state.demandType && demand.demandType && state.demandType !== demand.demandType) {
    fail(`controller state demandType ${state.demandType} does not match immutable demand type ${demand.demandType}.`);
  }
  const immutableDemandType = demand.demandType ?? state.demandType ?? null;
  const expectedAuthorityEntryMode = state.executionPlacement?.mode === "isolated"
    ? "pod-design"
    : demand.source?.designKey
      ? "design-delivery"
      : "controller-inline";
  const existingAuthority = state.demandAuthorityRef
    ? readJson(authorityFile, "demand authority")
    : null;
  let demandAuthority = null;
  let freezeDemandAuthority = false;
  if (existingAuthority) {
    try {
      demandAuthority = assertDemandAuthorityReady(existingAuthority, {
        workspaceRoot,
        demandKey: state.demandKey,
        demandType: immutableDemandType,
        entryMode: expectedAuthorityEntryMode,
        expectedDigest: state.demandAuthorityDigest,
      }).authority;
    } catch (error) {
      fail(`stored demand authority is invalid: ${error.message}`);
    }
    if (demandAuthorityInput) {
      let supplied;
      try {
        supplied = assertDemandAuthorityReady(demandAuthorityInput, {
          workspaceRoot,
          demandKey: state.demandKey,
          demandType: immutableDemandType,
          entryMode: expectedAuthorityEntryMode,
        }).authority;
      } catch (error) {
        fail(error.message);
      }
      if (demandAuthorityDigest(supplied) !== demandAuthorityDigest(demandAuthority)) {
        fail(`${DEMAND_AUTHORITY_FILE} is immutable after it is frozen; supplied demandAuthority does not match stored authority.`);
      }
    }
  } else if (demandAuthorityInput) {
    try {
      demandAuthority = assertDemandAuthorityReady(demandAuthorityInput, {
        workspaceRoot,
        demandKey: state.demandKey,
        demandType: immutableDemandType,
        entryMode: expectedAuthorityEntryMode,
      }).authority;
    } catch (error) {
      fail(error.message);
    }
    freezeDemandAuthority = true;
  }
  if (demandAuthority) {
    if (demandAuthority.demandKey !== state.demandKey) {
      fail(`demandAuthority.demandKey must equal ${state.demandKey}.`);
    }
  }
  if (taskContext?.workType === "implementation" && (state.demandType || demand.demandType || demandAuthority)) {
    if (!demandAuthority) {
      fail(`the first implementation package requires --demand-authority; freeze the proportional Design/controller demand contract before implementation dispatch.`);
    }
    if (demandAuthority.demandType === "research") {
      fail("research demand authority cannot authorize an implementation task package; create a requirement, bug, or supplement demand after the research decision.");
    }
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const nextMainState = state.state === "intake" || state.state === "needs-rework"
    ? "planned"
    : state.state;
  // A new task never acquires authority over parked work merely because it was
  // added while a rework route was open or happens to target the same repo.
  // Product rework re-dispatches the original task id; redesign uses the
  // explicit replacement edge below.
  const reviewRoute = replacesTargetTaskId ? "redesign-replacement" : null;
  const targetTasks = targetWindow
    ? [
        {
          targetTaskId,
          taskPackageId,
          targetWindow,
          summary: targetSummary,
          status: "pending",
          createdAt,
          ...(taskContext?.dependsOnTaskIds.length ? { dependsOnTaskIds: taskContext.dependsOnTaskIds } : {}),
          ...(testExecution ? { testExecution } : {}),
          ...(replacesTargetTaskId ? { replacesTargetTaskId } : {}),
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
    ...(taskContext ?? {}),
    ...(designIntent ? { designIntent } : {}),
    ...(acceptanceAnchors ? { acceptanceAnchors } : {}),
    ...(evidenceContract ? { evidenceContract } : {}),
    ...(testExecution ? { testExecution } : {}),
    ...(replacesTargetTaskId ? { replacesTargetTaskId } : {}),
    createdAt,
    ...(reviewRoute ? { reviewRoute } : {}),
    targetTasks,
  };
  // Reminder-first (never a gate): a dispatchable package without an evidence
  // contract leaves the craft gate dormant — the same forgotten-decision failure
  // mode testDecisionReminder fixes at create-demand. Surface it; authoring stays
  // Design's / the controller's judgment (doc-only packages legitimately skip it).
  const evidenceContractReminder = targetWindow && !testExecution && !evidenceContract
    ? "No craft review-input contract on this package: the craft gate stays dormant. If this is implementation work, consider authoring evidenceContract requirements (kinds like tests/change-scope; see wakeflow-target-craft). Reminder only — not a gate."
    : null;
  const nextState = {
    ...state,
    ...(freezeDemandAuthority ? {
      demandType: demandAuthority.demandType,
      demandAuthorityRef: DEMAND_AUTHORITY_FILE,
      demandAuthorityDigest: demandAuthorityDigest(demandAuthority),
    } : {}),
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
        ...(taskContext ?? {}),
        ...(designIntent ? { designIntent } : {}),
        ...(acceptanceAnchors ? { acceptanceAnchors } : {}),
        ...(evidenceContract ? { evidenceContract } : {}),
        ...(testExecution ? { testExecution } : {}),
        ...(replacesTargetTaskId ? { replacesTargetTaskId } : {}),
        createdAt,
        ...(reviewRoute ? { reviewRoute } : {}),
      },
    ],
    targetTasks: [
      ...(state.targetTasks ?? []).map((item) => (
        item.targetTaskId === replacesTargetTaskId
          ? { ...item, replacedByTargetTaskId: targetTaskId }
          : item
      )),
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
    evidenceRefs: [
      ...(sourceRef ? [sourceRef] : []),
      ...(freezeDemandAuthority ? [DEMAND_AUTHORITY_FILE] : []),
    ],
    allowedWrites: [
      "wakeflow-state.json",
      "controller-events.jsonl",
      ...(freezeDemandAuthority ? [DEMAND_AUTHORITY_FILE] : []),
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
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      jsonArtifacts: [
        ...(freezeDemandAuthority ? [{ file: authorityFile, value: demandAuthority }] : []),
        { file: packageFile, value: taskPackage },
      ],
      command: "add-task-package",
    });
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.taskPackages,
      `${createdAt} ${taskPackageId} → ${targetWindow || "(unassigned)"} — ${summary}${designIntent ? ` (intent: ${designIntent})` : ""}`);
    // The demand progress projection intentionally remains stale until render,
    // but the workspace entry must immediately reflect the authoritative state
    // change (especially the first demand-authority freeze).
    refreshWorkspaceProjection({ workspaceRoot, updatedAt: createdAt });
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
      ...(demandAuthority ? {
        demandAuthorityFile: relative(authorityFile),
        demandAuthorityDigest: demandAuthorityDigest(demandAuthority),
        demandType: demandAuthority.demandType,
        demandAuthorityFrozen: freezeDemandAuthority,
      } : {}),
      stateRevision: nextRevision,
      eventId,
      projectionStatus: "stale",
      ...(testExecution ? { testExecution } : {}),
      ...(replacesTargetTaskId ? { replacesTargetTaskId } : {}),
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

// A completed-but-unarchived demand may acquire a verified same-demand gap after
// its first completion decision. Continuing it is deliberately ONE locked
// controller operation: it records why the old completion is no longer the end
// of the story and adds the first concrete package in the same locked mutation.
// There is no empty "reopened" state for a controller to strand or branch from.
function commandContinueDemand() {
  const stateRoot = stateRootFromArg();
  withLockedStateRoot(stateRoot, () => commandContinueDemandLocked(stateRoot));
}

function commandContinueDemandLocked(stateRoot) {
  const continuationType = requireValue("--continuation-type");
  const allowedContinuationTypes = new Set(["verified-bug", "requirement-supplement", "optimization"]);
  if (!allowedContinuationTypes.has(continuationType)) {
    fail(`--continuation-type must be one of: ${[...allowedContinuationTypes].join(", ")}.`);
  }
  const reason = requireValue("--reason");
  const evidenceRefs = valuesFor("--evidence-ref");
  if (evidenceRefs.length === 0) {
    fail("continue-demand requires at least one --evidence-ref to the verified gap or explicit scope decision.");
  }
  const taskPackageId = requireValue("--task-package-id");
  const summary = requireValue("--summary");
  const targetWindow = requireValue("--target-window");
  const targetTaskId = requireValue("--target-task-id");
  const targetSummary = getValue("--target-summary", summary);
  const sourceRef = getValue("--source-ref", null);
  const designIntent = (getValue("--design-intent", "") || "").trim() || null;
  const acceptanceAnchors = validateAcceptanceAnchorsShape(parseOptionalJsonArg("--acceptance-anchors"));
  const taskContext = parseTaskPackageContext(acceptanceAnchors);
  const evidenceContract = validateEvidenceContractShape(parseOptionalJsonArg("--evidence-contract"));
  const demandAuthorityInput = parseOptionalJsonArg("--demand-authority");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const packageFile = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  const state = readJson(stateFile, "controller state");
  const demand = readJson(path.join(stateRoot, "demand.json"), "demand identity");
  const hostOwnership = ensureDemandHostOwnership(state);

  if (state.state !== "completed") {
    const direction = state.state === "archived"
      ? "Archived demand history is immutable; create a new demand and cite this archive instead."
      : "Only a completed, unarchived demand can use continue-demand; use add-task-package for active work.";
    fail(`continue-demand requires state=completed; ${state.demandKey} is ${state.state}. ${direction}`);
  }
  if ((state.blockers ?? []).length > 0) {
    fail("continue-demand refuses a completed state that still contains blockers; inspect and repair the inconsistent state first.");
  }
  const nonAcceptedTasks = (state.targetTasks ?? []).filter((item) => !["accepted", "superseded"].includes(item.status));
  const nonAcceptedPackages = (state.taskPackages ?? []).filter((item) => !["accepted", "superseded"].includes(item.status));
  if (nonAcceptedTasks.length > 0 || nonAcceptedPackages.length > 0) {
    fail(`continue-demand refuses an inconsistent completed state with non-accepted history; tasks: ${nonAcceptedTasks.map((item) => item.targetTaskId).join(", ") || "none"}; packages: ${nonAcceptedPackages.map((item) => item.taskPackageId).join(", ") || "none"}.`);
  }
  let priorCompletionEvent = null;
  try {
    const events = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    priorCompletionEvent = [...events].reverse().find((item) => item.type === "demand.completed" && item.to === "completed") ?? null;
  } catch (error) {
    fail(`continue-demand cannot trust controller completion history: ${error.message}`);
  }
  if (!priorCompletionEvent) {
    fail("continue-demand requires an explicit prior demand.completed event; do not legitimize a hand-edited completed state.");
  }
  if (existsSync(packageFile) || (state.taskPackages ?? []).some((item) => item.taskPackageId === taskPackageId)) {
    fail(`task package already exists: ${taskPackageId}`);
  }
  if ((state.targetTasks ?? []).some((item) => item.targetTaskId === targetTaskId)) {
    fail(`controller state already contains target task: ${targetTaskId}`);
  }

  const testExecution = testExecutionForNewTask({ stateRoot, state, targetWindow, targetTaskId });
  validateTaskPackageContextForTarget({
    taskContext,
    acceptanceAnchors,
    state,
    targetTaskId,
    testExecution,
  });
  for (const requirementRef of taskContext?.requirementRefs ?? []) {
    const issue = requirementRefIssue(workspaceRoot, requirementRef);
    if (issue) {
      fail(`invalid task package context: ${issue}`);
    }
  }
  if (state.demandAuthorityRef && state.demandAuthorityRef !== DEMAND_AUTHORITY_FILE) {
    fail(`controller state demandAuthorityRef must equal ${DEMAND_AUTHORITY_FILE}.`);
  }
  if (state.demandAuthorityRef && !state.demandAuthorityDigest) {
    fail(`controller state is missing the frozen demandAuthorityDigest for ${DEMAND_AUTHORITY_FILE}.`);
  }
  const authorityFile = path.join(stateRoot, DEMAND_AUTHORITY_FILE);
  if (!state.demandAuthorityRef && existsSync(authorityFile)) {
    fail(`unreferenced ${DEMAND_AUTHORITY_FILE} already exists; refuse to overwrite ambiguous demand authority. Reconcile the state root before continuing work.`);
  }
  if (state.demandType && demand.demandType && state.demandType !== demand.demandType) {
    fail(`controller state demandType ${state.demandType} does not match immutable demand type ${demand.demandType}.`);
  }
  const immutableDemandType = demand.demandType ?? state.demandType ?? null;
  const expectedAuthorityEntryMode = state.executionPlacement?.mode === "isolated"
    ? "pod-design"
    : demand.source?.designKey
      ? "design-delivery"
      : "controller-inline";
  let demandAuthority = null;
  let freezeDemandAuthority = false;
  if (state.demandAuthorityRef) {
    if (!existsSync(authorityFile)) fail(`controller state references missing ${DEMAND_AUTHORITY_FILE}.`);
    try {
      demandAuthority = assertDemandAuthorityReady(readJson(authorityFile, "demand authority"), {
        workspaceRoot,
        demandKey: state.demandKey,
        demandType: immutableDemandType,
        entryMode: expectedAuthorityEntryMode,
        expectedDigest: state.demandAuthorityDigest,
      }).authority;
    } catch (error) {
      fail(`stored demand authority is invalid: ${error.message}`);
    }
  }
  if (demandAuthorityInput) {
    let supplied;
    try {
      supplied = assertDemandAuthorityReady(demandAuthorityInput, {
        workspaceRoot,
        demandKey: state.demandKey,
        demandType: immutableDemandType,
        entryMode: expectedAuthorityEntryMode,
      }).authority;
    } catch (error) {
      fail(error.message);
    }
    if (demandAuthority && demandAuthorityDigest(supplied) !== demandAuthorityDigest(demandAuthority)) {
      fail(`${DEMAND_AUTHORITY_FILE} is immutable after it is frozen; supplied demandAuthority does not match stored authority.`);
    }
    if (!demandAuthority) {
      demandAuthority = supplied;
      freezeDemandAuthority = true;
    }
  }
  if (taskContext?.workType === "implementation" && (state.demandType || demand.demandType) && !demandAuthority) {
    fail(`continue-demand requires --demand-authority for the first implementation continuation of a legacy demand.`);
  }
  if (taskContext?.workType === "implementation" && demandAuthority?.demandType === "research") {
    fail("research demand authority cannot authorize an implementation continuation.");
  }
  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const continuationId = `continuation-${String(nextRevision).padStart(4, "0")}`;
  const continuation = {
    continuationId,
    type: continuationType,
    reason,
    evidenceRefs,
    priorCompletionEventId: priorCompletionEvent.eventId,
    priorCompletionRevision: Number(priorCompletionEvent.stateRevision ?? state.revision ?? 0),
    createdAt,
  };
  const targetTask = {
    targetTaskId,
    taskPackageId,
    targetWindow,
    summary: targetSummary,
    status: "pending",
    createdAt,
    continuationId,
    ...(taskContext?.dependsOnTaskIds.length ? { dependsOnTaskIds: taskContext.dependsOnTaskIds } : {}),
    ...(testExecution ? { testExecution } : {}),
  };
  const taskPackage = {
    schemaVersion,
    taskPackageId,
    demandKey: state.demandKey,
    summary,
    status: "pending",
    sourceRef,
    ...(taskContext ?? {}),
    ...(designIntent ? { designIntent } : {}),
    ...(acceptanceAnchors ? { acceptanceAnchors } : {}),
    ...(evidenceContract ? { evidenceContract } : {}),
    ...(testExecution ? { testExecution } : {}),
    continuation,
    createdAt,
    targetTasks: [targetTask],
  };
  const nextState = {
    ...state,
    ...(freezeDemandAuthority ? {
      demandType: demandAuthority.demandType,
      demandAuthorityRef: DEMAND_AUTHORITY_FILE,
      demandAuthorityDigest: demandAuthorityDigest(demandAuthority),
    } : {}),
    state: "planned",
    stateReason: `${continuationType} continuation: ${reason}`,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: ["prepare-dispatch-from-state", "add-task-package", "wakeflow-render-progress"],
    decisionsRequired: [],
    taskPackages: [
      ...(state.taskPackages ?? []),
      {
        taskPackageId,
        summary,
        status: "pending",
        sourceRef,
        ...(taskContext ?? {}),
        ...(designIntent ? { designIntent } : {}),
        ...(acceptanceAnchors ? { acceptanceAnchors } : {}),
        ...(evidenceContract ? { evidenceContract } : {}),
        ...(testExecution ? { testExecution } : {}),
        continuation,
        createdAt,
      },
    ],
    targetTasks: [...(state.targetTasks ?? []), targetTask],
    windows: upsertWindowState(state.windows ?? [], {
      windowName: targetWindow,
      windowState: "pending",
      taskPackageId,
      targetTaskId,
    }),
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
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
    type: "demand.continued",
    from: "completed",
    to: "planned",
    reason: `${continuationType}: ${reason}`,
    evidenceRefs: [...evidenceRefs, ...(freezeDemandAuthority ? [DEMAND_AUTHORITY_FILE] : [])],
    continuationId,
    continuationType,
    taskPackageId,
    targetTaskId,
    allowedWrites: [
      "wakeflow-state.json",
      "controller-events.jsonl",
      ...(freezeDemandAuthority ? [DEMAND_AUTHORITY_FILE] : []),
      `task-packages/${slug(taskPackageId)}.json`,
    ],
    forbiddenConclusions: [
      "continuation-erases-prior-completion",
      "continuation-is-dispatch",
      "continuation-authorizes-unrelated-scope",
      "continuation-reopens-archived-history",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
  };

  if (write) {
    mkdirSync(path.dirname(packageFile), { recursive: true });
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      jsonArtifacts: [
        ...(freezeDemandAuthority ? [{ file: authorityFile, value: demandAuthority }] : []),
        { file: packageFile, value: taskPackage },
      ],
      command: "continue-demand",
    });
    appendProgressTimeline(stateRoot, nextState, PROGRESS_SECTIONS.decisions,
      `${createdAt} demand continued (${continuationType}) — ${reason}; first package ${taskPackageId} → ${targetWindow}`);
    refreshWorkspaceProjection({ workspaceRoot, updatedAt: createdAt });
  }

  output({
    ok: true,
    command: "continue-demand",
    hostOwnership,
    wrote: write,
    demandKey: state.demandKey,
    stateRoot: relative(stateRoot),
    previousState: "completed",
    nextState: "planned",
    continuation,
    taskPackageId,
    taskPackageFile: relative(packageFile),
    targetTaskId,
    targetWindow,
    stateRevision: nextRevision,
    eventId,
    ...(demandAuthority ? {
      demandAuthorityFile: relative(authorityFile),
      demandAuthorityDigest: demandAuthorityDigest(demandAuthority),
      demandAuthorityFrozen: freezeDemandAuthority,
    } : {}),
    projectionStatus: "stale",
    forbiddenConclusions: event.forbiddenConclusions,
    agentNext: write
      ? "The prior completion remains in history. Review the new package, then prepare and send its delivery; the demand must pass review and complete-demand again before archive."
      : "Dry-run only. Re-run with --write to record the continuation and its first task package in one locked operation.",
  }, [
    `${write ? "Continued" : "Would continue"} completed demand ${state.demandKey} with ${taskPackageId}.`,
    "The prior completion event and all accepted task evidence remain unchanged.",
    "No dispatch, host send, acceptance, or archive was performed.",
  ]);
}

function deliveryEnvelopeFileForId(deliveryId, stateRef = null) {
  return path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/delivery-envelopes",
    transportArtifactFileName(deliveryId, stateRef),
  );
}

function preparedDeliveryForTargetTask(targetTask, stateRef, dispatchGroup) {
  if (!dispatchGroup || !stateRef?.stateRoot) return null;
  const deliveryDir = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/delivery-envelopes");
  const packetDir = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  if (!existsSync(deliveryDir) || !existsSync(packetDir)) return null;
  const packets = [];
  for (const name of readdirSync(packetDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = path.join(packetDir, name);
      const packet = JSON.parse(readFileSync(file, "utf8"));
      if (
        packet.targetWindow === targetTask.targetWindow
        && (packet.taskId === targetTask.targetTaskId
          || packet.targetTaskId === targetTask.targetTaskId
          || packet.stateRef?.targetTaskId === targetTask.targetTaskId)
        && packet.dispatchGroup === dispatchGroup
        && path.resolve(workspaceRoot, packet.stateRef?.stateRoot ?? "") === path.resolve(workspaceRoot, stateRef.stateRoot)
        && (!packet.stateRef?.demandKey || packet.stateRef.demandKey === stateRef.demandKey)
        && packet.packetDigest === dispatchPacketDigest(packet)
      ) {
        packets.push({ file, packet });
      }
    } catch {
      // Delivery diagnostics own malformed transport artifacts. They cannot
      // authorize a state-only result to release a delivery lease.
    }
  }
  const matches = [];
  for (const name of readdirSync(deliveryDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = path.join(deliveryDir, name);
      const envelope = JSON.parse(readFileSync(file, "utf8"));
      const source = packets.find(({ packet }) => packet.id === envelope.sourcePacketId);
      if (
        source
        && envelope.targetWindow === targetTask.targetWindow
        && envelope.taskId === targetTask.targetTaskId
        && envelope.dispatchGroup === dispatchGroup
        && envelope.sourcePacketDigest === source.packet.packetDigest
        && envelope.preparationDigest === dispatchPreparationDigest({ packet: source.packet, envelope })
      ) {
        matches.push({ file, envelope });
      }
    } catch {
      // Fail closed: an unreadable or broken chain is not a delivery context.
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function targetTaskDeliveryContext(targetTask, stateRef = null, resultDispatchGroup = "") {
  const prepared = !targetTask.delivery
    ? preparedDeliveryForTargetTask(targetTask, stateRef, resultDispatchGroup)
    : null;
  const delivery = targetTask.delivery ?? (prepared
    ? {
        deliveryId: prepared.envelope.deliveryId,
        deliveryFile: relative(prepared.file),
        dispatchGroup: prepared.envelope.dispatchGroup,
      }
    : null);
  const deliveryId = delivery?.deliveryId ?? null;
  const envelopeFile = delivery?.deliveryFile
    ? resolveFromWorkspace(delivery.deliveryFile)
    : deliveryId
      ? deliveryEnvelopeFileForId(deliveryId, stateRef)
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
  const results = latestResultsByTargetTask(readTargetResults(stateRoot));
  const taskIdsWithResults = new Set(results.keys());
  if (importedCurrentResult) taskIdsWithResults.add(importedTargetTaskId);
  const reviewScope = controllerReductionScope(state.targetTasks ?? [], taskIdsWithResults);
  const targetTasks = reviewScope.reviewableTargetTasks;
  const remainingTaskIds = [];

  for (const task of targetTasks) {
    if (hasPendingReworkDecision(task)) {
      remainingTaskIds.push(task.targetTaskId);
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
    changedRepos: result.changedRepos ?? [],
    commits: result.commits ?? [],
    commitDisposition: result.commitDisposition ?? null,
    craftEvidence: result.craftEvidence ?? [],
    resultMapping: result.resultMapping ?? null,
  });
}

function targetResultsEquivalent(left, right) {
  return targetResultComparable(left) === targetResultComparable(right);
}

function targetResultIdentity(targetTaskId, result) {
  return {
    targetTaskId,
    resultId: result.resultId,
    resultRevision: Number(result.resultRevision ?? 1),
    dispatchGroup: result.dispatchGroup || null,
    status: result.status,
  };
}

function resultSnapshotsForTasks(targetTasks, results) {
  return targetTasks
    .map((task) => {
      const result = results.get(task.targetTaskId);
      return result ? targetResultIdentity(task.targetTaskId, result) : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.targetTaskId.localeCompare(right.targetTaskId));
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
  if (["accepted", "superseded"].includes(targetTask.status)) {
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
  const changedRepos = valuesFor("--changed-repo");
  const commits = valuesFor("--commit");
  const commitDisposition = (getValue("--commit-disposition", "") || "").trim();
  if (commitDisposition && !COMMIT_DISPOSITIONS.includes(commitDisposition)) {
    fail(`--commit-disposition must be one of: ${COMMIT_DISPOSITIONS.join(", ")}.`);
  }
  // Typed craft evidence for the execution-craft contract (W-Target). Optional JSON array
  // of { kind, ref|value|commit, verify }. Absent = zero behavior change.
  const craftEvidence = validateCraftEvidenceEntries(parseOptionalJsonArrayArg("--craft-evidence"));
  const summary = (getValue("--summary", "") || "").trim();
  if (
    status === "completed"
    && summary.length === 0
    && evidenceRefs.length === 0
    && verification.length === 0
    && commits.length === 0
    && craftEvidence.length === 0
  ) {
    fail("a completed target result must include reviewable content: provide --summary plus --evidence-ref, --verification, --commit, or --craft-evidence.");
  }
  const taskPackage = (state.taskPackages ?? []).find((item) => item.taskPackageId === targetTask.taskPackageId) ?? null;
  const resultContract = evaluateTargetResultContract({
    taskPackage,
    result: {
      status,
      summary,
      evidenceRefs,
      verification,
      changedRepos,
      commits,
      commitDisposition: commitDisposition || undefined,
      craftEvidence,
    },
  });
  if (resultContract.recordIssues.length > 0) {
    fail(`target result does not satisfy ${resultContract.contract}: ${targetResultContractIssueMessage(resultContract.recordIssues)}.`);
  }
  const deliveryContext = targetTaskDeliveryContext(targetTask, {
    demandKey: state.demandKey,
    stateRoot: relative(stateRoot),
  }, resultDispatchGroup);
  const currentDispatchGroup = targetTask.delivery?.dispatchGroup || deliveryContext.dispatchGroup || "";
  const knownDispatchGroups = new Set(knownDispatchGroupsForTargetTask(targetWindow, targetTaskId, stateRoot, state.demandKey));
  if (currentDispatchGroup) knownDispatchGroups.add(currentDispatchGroup);
  if (currentDispatchGroup && !resultDispatchGroup) {
    fail(`target task ${targetTaskId} was dispatched in group ${currentDispatchGroup}; --dispatch-group is required so a late result cannot be mistaken for the current round.`);
  }
  if (resultDispatchGroup && !knownDispatchGroups.has(resultDispatchGroup)) {
    fail(`--dispatch-group ${resultDispatchGroup} is unknown for ${targetWindow} / ${targetTaskId}; known groups: ${[...knownDispatchGroups].sort().join(", ")}.`);
  }
  const incomingDispatchGroup = resultDispatchGroup ?? undefined;
  const historyOnly = Boolean(currentDispatchGroup && incomingDispatchGroup && incomingDispatchGroup !== currentDispatchGroup);
  const currentResults = selectCurrentStateRootResults({
    items: readStateRootTargetResultItems(stateRoot, readJson),
    state,
    fail,
  });
  let currentItem = currentResults.get(targetTaskId) ?? null;
  if (!historyOnly && !currentItem && incomingDispatchGroup === currentDispatchGroup) {
    // A newer sent round deliberately makes the prior round non-current for
    // review before its replacement result exists. Keep using that stable
    // top-level file only as the rotation source when the new round arrives.
    const markedPrior = readStateRootTargetResultItems(stateRoot, readJson)
      .filter((item) => (item.result?.targetTaskId || item.result?.taskId) === targetTaskId)
      .filter((item) => item.result?.currentResult === true);
    if (markedPrior.length > 1) {
      fail(`multiple current target results exist for ${targetTaskId}; repair the state root before importing the replacement round.`);
    }
    currentItem = markedPrior[0] ?? null;
  }
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
    summary,
    changedRepos,
    commits,
    ...(commitDisposition ? { commitDisposition } : {}),
    evidenceRefs,
    verification,
    risks,
    ...(craftEvidence.length ? { craftEvidence } : {}),
    resultMapping: resultContract.mapping,
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
    const lockFile = path.join(
      workspaceRoot,
      ".wakeflow-local/wakeflow-delivery/locks",
      `${stableArtifactPart(targetWindow, { fallback: "window" })}.json`,
    );
    const taskDeliveryId = targetTask.delivery?.deliveryId || deliveryContext.deliveryId;
    const taskDispatchGroup = targetTask.delivery?.dispatchGroup || deliveryContext.dispatchGroup;
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
  const results = latestResultsByTargetTask(readTargetResults(stateRoot));
  const reviewScope = controllerReductionScope(allTargetTasks, results.keys());
  const targetTasks = reviewScope.reviewableTargetTasks;
  if (targetTasks.length === 0) {
    fail("controller state has no dispatched or result-bearing target tasks to reduce; dispatch a pending target before result review.");
  }
  const readyResultIds = [];
  const blockedResultIds = [];
  const missingTargetTaskIds = [];
  const missingEvidenceRefs = [];
  const craftEvidenceGaps = [];
  const resultContractGaps = [];
  const evidenceRefs = [];

  for (const task of targetTasks) {
    const podTarget = evidenceWorkRootForTarget(stateRoot, state, task.targetWindow);
    if (hasPendingReworkDecision(task)) {
      missingTargetTaskIds.push(task.targetTaskId);
      continue;
    }
    const result = results.get(task.targetTaskId);
    if (!result) {
      missingTargetTaskIds.push(task.targetTaskId);
      continue;
    }
    missingEvidenceRefs.push(...missingEvidenceRefsForTargetResult(
      stateRoot,
      state,
      task,
      result,
      podTarget,
    ));
    if (result.status === "completed") {
      craftEvidenceGaps.push(...craftEvidenceGapsForTargetResult(
        stateRoot,
        state,
        task,
        result,
        podTarget,
      ));
      const taskPackage = (state.taskPackages ?? []).find((item) => item.taskPackageId === task.taskPackageId) ?? null;
      const contract = evaluateTargetResultContract({ taskPackage, result });
      resultContractGaps.push(
        ...[...contract.recordIssues, ...contract.reviewIssues].map((gap) => ({
          targetWindow: task.targetWindow,
          targetTaskId: task.targetTaskId,
          taskPackageId: task.taskPackageId,
          ...gap,
        })),
      );
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
      reviewGate: "review-input-repair-required",
      missingEvidenceRefs,
      forbiddenConclusions: [
        "all-results-present-is-not-evidence-ready",
        "missing-evidence-ref-can-enter-transition-candidate",
        "reduce-results-repairs-target-result",
      ],
      agentNext: "Stop: target results are present, but declared path-like review-input refs are missing. Run wakeflow_review_pack, repair or re-record the target result inputs, then rerun reduce-results; no state was changed.",
    });
    process.exitCode = 1;
    throw new CliExit("missing declared review-input refs block reduce-results");
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
      reviewGate: "craft-review-inputs-required",
      craftEvidenceGaps,
      forbiddenConclusions: [
        "completed-result-without-required-craft-evidence-is-acceptable",
        "craft-evidence-gap-can-enter-transition-candidate",
        "reduce-results-produces-craft-evidence",
      ],
      // NOTE: do NOT say "re-dispatch" here — the gated task is `sent`, and dispatch
      // eligibility only admits pending/needs-rework/missing-result. The recovery path
      // (same as review-input repair) is a CORRECTED IMPORT: a sent task accepts a new result.
      agentNext: "Stop: a completed target result does not satisfy its task package's craft review-input requirements (a required craftEvidence kind is absent, or a declared artifact does not resolve). Have the target window produce the required review inputs (the wakeflow-target-craft skill lists how) and record a corrected result — a sent task accepts a new import — or record the honest blocked/needs-review status; then rerun reduce-results. No state was changed.",
    });
    process.exitCode = 1;
    throw new CliExit("craft evidence gaps block reduce-results");
  }

  if (
    missingTargetTaskIds.length === 0
    && missingEvidenceRefs.length === 0
    && craftEvidenceGaps.length === 0
    && resultContractGaps.length > 0
  ) {
    output({
      ok: false,
      command: "reduce-results",
      wrote: false,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: state.state,
      stateRevisionUnchanged: state.revision,
      reviewGate: "target-result-contract-required",
      resultContractGaps,
      forbiddenConclusions: [
        "complete-result-mapping-is-controller-acceptance",
        "commit-expectation-mismatch-can-enter-transition-candidate",
        "reduce-results-repairs-target-result",
      ],
      agentNext: "Stop: a completed target result does not match its authoritative task package result contract. Record a corrected result with the required acceptance/Test mapping and commit disposition, or record the honest blocked/needs-review status; then rerun reduce-results. No state was changed.",
    });
    process.exitCode = 1;
    throw new CliExit("target result contract gaps block reduce-results");
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
  const resultSnapshots = candidateId ? resultSnapshotsForTasks(targetTasks, results) : [];
  const decision = candidateId ? {
    kind: "review-decision",
    candidateId,
    summary: blockedResultIds.length > 0
      ? "Target results include blocked outcomes; total-control decision is required."
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
    resultSnapshots,
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
      const result = results.get(task.targetTaskId);
      if (!reviewScope.targetTaskIds.includes(task.targetTaskId)) {
        if (
          task.status === "missing-result"
          && !result
          && !taskExpectsTargetResult(task)
          && !isReworkRouteTask(task)
        ) {
          return { ...task, status: "pending", resultId: null };
        }
        return task;
      }
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
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      jsonArtifacts: candidate
        ? [{
            file: path.join(stateRoot, "transition-candidates", `${slug(candidate.candidateId)}.json`),
            value: candidate,
          }]
        : [],
      command: "reduce-results",
    });
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
      resultSnapshots,
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
  const rawCandidateTaskIds = new Set(candidate.targetTaskIds ?? []);
  const knownCandidateTasks = (state.targetTasks ?? []).filter((item) => rawCandidateTaskIds.has(item.targetTaskId));
  const unknownCandidateTaskIds = [...rawCandidateTaskIds].filter((targetTaskId) => !knownCandidateTasks.some((item) => item.targetTaskId === targetTaskId));
  if (unknownCandidateTaskIds.length > 0) {
    fail(`transition candidate ${candidateId} references unknown target tasks: ${unknownCandidateTaskIds.join(", ")}`);
  }
  if (!Array.isArray(candidate.resultSnapshots)) {
    fail(`transition candidate ${candidateId} predates immutable result snapshots; rerun reduce-results before deciding.`);
  }
  const candidateResultSnapshots = [...candidate.resultSnapshots]
    .sort((left, right) => String(left?.targetTaskId ?? "").localeCompare(String(right?.targetTaskId ?? "")));
  const currentResults = latestResultsByTargetTask(readTargetResults(stateRoot));
  const currentResultSnapshots = resultSnapshotsForTasks(knownCandidateTasks, currentResults);
  if (!isDeepStrictEqual(candidateResultSnapshots, currentResultSnapshots)) {
    fail(`transition candidate ${candidateId} is stale because its current target result identity changed; rerun reduce-results before deciding.`);
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
  const decidedTargetTasks = (state.targetTasks ?? []).map((item) => {
    if (!candidateTaskIds.has(item.targetTaskId)) return item;
    // RA2 / redesign-route: per-task handling counts. A rework decision is one rework cycle (same
    // product window, re-dispatched). A redesign decision is one Design-rethink cycle: the task is
    // parked needs-rework like rework, but it is routed back to Design (reviewDecision="redesign"
    // + redesignCount), not re-dispatched to a product window. Design's handoff remains stateless;
    // the next state-root product task must explicitly replace this parked task.
    if (decision === "rework") {
      return { ...item, status: nextTaskStatus, reviewDecision: decision, counts: { ...(item.counts ?? {}), reworkCount: (item.counts?.reworkCount ?? 0) + 1 } };
    }
    if (decision === "redesign") {
      return { ...item, status: nextTaskStatus, reviewDecision: decision, counts: { ...(item.counts ?? {}), redesignCount: (item.counts?.redesignCount ?? 0) + 1 } };
    }
    return { ...item, status: nextTaskStatus, reviewDecision: decision };
  });
  const acceptedReplacementTaskIds = decision === "accept"
    ? new Set(decidedTargetTasks
      .filter((item) => candidateTaskIds.has(item.targetTaskId) && item.replacesTargetTaskId)
      .map((item) => item.targetTaskId))
    : new Set();
  const supersededTargetTaskIds = new Set();
  const acceptedLineageTaskIds = new Set(acceptedReplacementTaskIds);
  let lineageExpanded = true;
  while (lineageExpanded) {
    lineageExpanded = false;
    for (const item of decidedTargetTasks) {
      if (
        !item.replacedByTargetTaskId
        || !acceptedLineageTaskIds.has(item.replacedByTargetTaskId)
        || supersededTargetTaskIds.has(item.targetTaskId)
      ) {
        continue;
      }
      supersededTargetTaskIds.add(item.targetTaskId);
      acceptedLineageTaskIds.add(item.targetTaskId);
      lineageExpanded = true;
    }
  }
  const nextTargetTasks = decidedTargetTasks.map((item) => {
    if (!supersededTargetTaskIds.has(item.targetTaskId)) {
      return item;
    }
    return {
      ...item,
      status: "superseded",
      supersededAt: createdAt,
    };
  });
  const decisionAndLineageTaskIds = new Set([
    ...candidateTaskIds,
    ...supersededTargetTaskIds,
  ]);
  const nextState = {
    ...state,
    state: nextMainState,
    stateReason: reason,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: decision === "accept"
      ? ["add-task-package", "complete-demand", "wakeflow-render-progress"]
      : decision === "rework"
        ? ["prepare-dispatch-from-state", "wakeflow-render-progress"]
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
    taskPackages: updatePackageStatusesForDecision(
      state.taskPackages ?? [],
      nextTargetTasks,
      decisionAndLineageTaskIds,
      nextTaskStatus,
    ),
    targetTasks: nextTargetTasks,
    windows: (state.windows ?? []).map((item) => ({
      ...item,
      windowState: (item.targetTaskIds ?? []).some((targetTaskId) => candidateTaskIds.has(targetTaskId))
        ? nextTaskStatus
        : (item.targetTaskIds ?? []).some((targetTaskId) => supersededTargetTaskIds.has(targetTaskId))
          ? "superseded"
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
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      command: "decide-review",
    });
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
      supersededTargetTaskIds: [...supersededTargetTaskIds],
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
  if (["completed", "archived", "cancelled"].includes(state.state)) {
    fail(`demand is already terminal (${state.state}): ${state.demandKey}`);
  }
  if ((state.taskPackages ?? []).length === 0 || (state.targetTasks ?? []).length === 0) {
    fail("complete-demand requires at least one task package and one target task; an empty demand cannot be completed.");
  }
  const openTasks = (state.targetTasks ?? []).filter((task) => !["accepted", "superseded"].includes(task.status));
  const openPackages = (state.taskPackages ?? []).filter((taskPackage) => !["accepted", "superseded"].includes(taskPackage.status));
  if (openTasks.length > 0 || openPackages.length > 0) {
    fail(`complete-demand requires all task packages and target tasks to be accepted; open tasks: ${openTasks.map((item) => item.targetTaskId).join(", ") || "none"}; open packages: ${openPackages.map((item) => item.taskPackageId).join(", ") || "none"}`);
  }
  if ((state.blockers ?? []).length > 0) {
    fail("complete-demand cannot close a demand with active blockers.");
  }
  if ((state.decisionsRequired ?? []).length > 0) {
    fail("complete-demand cannot close a demand with pending controller decisions.");
  }
  if (["review-ready", "waiting-results"].includes(state.state)) {
    fail(`complete-demand cannot close a demand while controller state is ${state.state}; finish the current result/review cycle first.`);
  }
  if (state.state !== "planned") {
    fail(`complete-demand requires controller state planned after the final explicit accept decision; current state is ${state.state}.`);
  }

  const targetTasks = state.targetTasks ?? [];
  const taskById = new Map(targetTasks.map((task) => [task.targetTaskId, task]));
  const terminalLineageIssue = (task, trail = new Set()) => {
    if (trail.has(task.targetTaskId)) {
      return `replacement lineage contains a cycle at ${task.targetTaskId}`;
    }
    if (task.status === "accepted") {
      if (task.reviewDecision !== "accept") {
        return `accepted task ${task.targetTaskId} has no explicit accept decision`;
      }
      if (task.replacesTargetTaskId) {
        const replaced = taskById.get(task.replacesTargetTaskId);
        if (!replaced || replaced.replacedByTargetTaskId !== task.targetTaskId || replaced.status !== "superseded") {
          return `accepted replacement ${task.targetTaskId} has no mutually linked superseded predecessor`;
        }
      }
      return null;
    }
    if (task.status !== "superseded") {
      return `task ${task.targetTaskId} is not terminal`;
    }
    if (!task.replacedByTargetTaskId) {
      return `superseded task ${task.targetTaskId} has no replacement`;
    }
    const replacement = taskById.get(task.replacedByTargetTaskId);
    if (!replacement || replacement.replacesTargetTaskId !== task.targetTaskId) {
      return `superseded task ${task.targetTaskId} has no mutually linked replacement`;
    }
    return terminalLineageIssue(replacement, new Set([...trail, task.targetTaskId]));
  };
  const lineageIssue = targetTasks
    .map((task) => terminalLineageIssue(task))
    .find(Boolean);
  if (lineageIssue) {
    fail(`complete-demand rejected invalid terminal task lineage: ${lineageIssue}.`);
  }
  const packageIssue = (state.taskPackages ?? [])
    .map((taskPackage) => {
      const packageTasks = targetTasks.filter((task) => task.taskPackageId === taskPackage.taskPackageId);
      if (packageTasks.length === 0) return `task package ${taskPackage.taskPackageId} has no target tasks`;
      if (taskPackage.status === "superseded" && !packageTasks.every((task) => task.status === "superseded")) {
        return `superseded task package ${taskPackage.taskPackageId} contains non-superseded tasks`;
      }
      if (
        taskPackage.status === "accepted"
        && (
          !packageTasks.every((task) => ["accepted", "superseded"].includes(task.status))
          || !packageTasks.some((task) => task.status === "accepted")
        )
      ) {
        return `accepted task package ${taskPackage.taskPackageId} has no accepted terminal task set`;
      }
      return null;
    })
    .find(Boolean);
  if (packageIssue) {
    fail(`complete-demand rejected invalid terminal package lineage: ${packageIssue}.`);
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
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      command: "complete-demand",
    });
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
// review-input gate, open tasks stay in their last honest status as history. A
// cancelled root remains unarchived authority until it is archived. A
// cancelled main-placement demand therefore still owns the mainline lane,
// while a cancelled isolated demand remains observable without becoming a
// numeric slot. Open isolation windows must still close before archive.
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
    const releasedWindowLocks = write ? releaseDemandWindowLocks(state) : [];
    output({
      ok: true,
      command: "cancel-demand",
      hostOwnership,
      wrote: false,
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      previousState: "cancelled",
      nextState: "cancelled",
      stateRevision: state.revision,
      releasedWindowLocks,
      note: "idempotent cancellation replay; no second event or revision was created",
      agentNext: "The demand remains cancelled. Archive it to retire the active authority after closing any isolation windows.",
    }, [
      `Demand ${state.demandKey} was already cancelled; state was not changed.`,
      releasedWindowLocks.length
        ? `Released residual delivery lock(s): ${releasedWindowLocks.join(", ")}.`
        : "No matching residual delivery locks remained.",
    ]);
    return;
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = nextEventId(createdAt, nextRevision);
  const openTasks = (state.targetTasks ?? []).filter((task) => !["accepted", "completed", "superseded"].includes(task.status));
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
      "cancel-releases-mainline-before-archive",
    ],
    stateRevision: nextRevision,
    ...(hostOwnership.claimed || hostOwnership.transferredFrom ? { hostOwnership } : {}),
  };

  let releasedWindowLocks = [];
  if (write) {
    commitStateTransition({
      stateRoot,
      stateFile,
      eventsFile,
      event,
      nextState,
      command: "cancel-demand",
    });
    // Release locks only after cancellation is authoritative. If the process
    // stops here, replaying cancel-demand against the already-cancelled state
    // performs this cleanup without creating another event or revision.
    releasedWindowLocks = releaseDemandWindowLocks(nextState);
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
      agentNext: state.executionPlacement?.mode === "main"
        ? "Demand is cancelled, not archived: it still owns the mainline lane. Its in-flight window delivery locks were released; a window mid-task may still finish and return a late result (recorded as history only). Archive after cleanup to release the mainline lane. Recorded evidence stays untouched."
        : "Demand is cancelled, not archived: it remains observable isolated authority. Its in-flight window delivery locks were released; a window mid-task may still finish and return a late result (recorded as history only). Close any open isolation windows, then archive it. Recorded evidence stays untouched.",
      appendLog: {
        type: "decision",
        decision: `cancelled: ${reason}`,
        eventId,
      },
    },
    [
      `${write ? "Recorded" : "Would record"} demand cancellation for ${state.demandKey}.`,
      "No acceptance, dispatch, or evidence deletion was performed; archive to retire the active authority.",
    ],
  );
}

function releaseDemandWindowLocks(state) {
  const releasedWindowLocks = [];
  for (const task of state.targetTasks ?? []) {
    const deliveryId = task.delivery?.deliveryId;
    if (!deliveryId || !task.targetWindow) continue;
    const lockFile = path.join(
      workspaceRoot,
      ".wakeflow-local/wakeflow-delivery/locks",
      `${stableArtifactPart(task.targetWindow, { fallback: "window" })}.json`,
    );
    const released = releaseWindowLockForResult(
      lockFile,
      (lock) => !lock.deliveryId || lock.deliveryId === deliveryId,
    );
    if (released) releasedWindowLocks.push(task.targetWindow);
  }
  return releasedWindowLocks;
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
    const terminalStatuses = new Set(["accepted", "superseded"]);
    const allPackageTasksDecided = packageTasks.length > 0 && (
      nextTaskStatus === "accepted"
        ? packageTasks.every((task) => terminalStatuses.has(task.status))
        : packageTasks.every((task) => task.status === nextTaskStatus)
    );
    const decidedStatus = nextTaskStatus === "accepted"
      && packageTasks.every((task) => task.status === "superseded")
      ? "superseded"
      : nextTaskStatus;
    return {
      ...item,
      status: allPackageTasksDecided ? decidedStatus : item.status,
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
    counts: { open: tasks.filter((task) => !["accepted", "superseded"].includes(task.status)).length, total: tasks.length },
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
  if (write) assertDemandWritable(state, "focus-doc", stateRoot);
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

const ARCHIVE_PENDING_INTENT_FILE = "wakeflow-archive.pending-intent.json";

class WakeflowArchiveStagedPrivacyError extends Error {
  constructor(message) {
    super(message);
    this.code = "WAKEFLOW_ARCHIVE_STAGED_PRIVACY";
  }
}

function archivePendingIntentFile(stateRoot) {
  return path.join(stateRoot, ARCHIVE_PENDING_INTENT_FILE);
}

function archivePathEntryExists(file) {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function assertArchivePreservedBoundary(preservedRoot) {
  const localRoot = path.join(workspaceRoot, ".wakeflow-local");
  const expected = path.join(localRoot, "preserved");
  if (path.resolve(preservedRoot) !== path.resolve(expected)) {
    fail(`archive preserved root must be ${relative(expected)}.`);
  }
  for (const [candidate, label] of [
    [localRoot, "archive local root"],
    [preservedRoot, "archive preserved root"],
  ]) {
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail(`cannot inspect ${label} ${relative(candidate)}: ${error.message}`);
    }
    if (stat.isSymbolicLink()) {
      fail(`${label} cannot be a symbolic link: ${relative(candidate)}.`);
    }
    if (candidate === localRoot && !stat.isDirectory()) {
      fail(`${label} must be a directory when it exists: ${relative(candidate)}.`);
    }
  }
  const canonicalWorkspace = realpathSync(workspaceRoot);
  const canonicalPreserved = realPathWithMissingTail(preservedRoot);
  const rel = path.relative(canonicalWorkspace, canonicalPreserved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`archive preserved root must stay inside the workspace: ${relative(preservedRoot)}.`);
  }
}

function archiveTreeDigest(root) {
  const hash = createHash("sha256");
  let entries = 0;
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relativePath = (prefix ? `${prefix}/${name}` : name).split(path.sep).join("/");
      const stat = lstatSync(absolute);
      entries += 1;
      if (stat.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        visit(absolute, relativePath);
        continue;
      }
      if (stat.isFile()) {
        const content = readFileSync(absolute);
        hash.update(`file\0${relativePath}\0${content.length}\0`);
        hash.update(content);
        hash.update("\0");
        continue;
      }
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        hash.update(`symlink\0${relativePath}\0${Buffer.byteLength(target)}\0${target}\0`);
        continue;
      }
      throw new Error(`archive tree contains an unsupported filesystem entry: ${relative(absolute)}`);
    }
  };
  visit(root);
  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
    entries,
  };
}

function validArchiveTreeDigest(digest) {
  return digest
    && typeof digest === "object"
    && !Array.isArray(digest)
    && digest.algorithm === "sha256"
    && typeof digest.value === "string"
    && /^[a-f0-9]{64}$/.test(digest.value)
    && Number.isInteger(digest.entries)
    && digest.entries >= 0;
}

const ARCHIVE_HOST_EVENTS_AFTER_TERMINAL = new Set([
  "demand.host-adopted",
  "demand.host-transferred",
]);
const ARCHIVE_POD_CLOSE_EVENTS_AFTER_TERMINAL = new Set([
  "pod.close-planned",
  "pod.window-logically-closed",
  "pod.closed",
]);
const ARCHIVE_POD_CLOSE_WRITES = new Set([
  "wakeflow-state.json",
  "controller-events.jsonl",
]);
const ARCHIVE_POD_CLOSE_FORBIDDEN_CONCLUSIONS = new Set([
  "pod-resource-state-is-demand-acceptance",
  "host-receipt-is-product-result",
  "logical-close-proves-physical-worktree-removal",
]);
const ARCHIVE_POD_PRE_CLOSE_PHASES = new Set([
  "reserved",
  "creating-control",
  "control-ready",
  "designing",
  "creating-products",
  "execution-ready",
  "retryable",
  "blocked",
  "cancelling",
]);
const POD_CLOSE_RECEIPT_REASON_PREFIX = "host close receipt recorded for ";

function exactStringSet(values, expected) {
  return Array.isArray(values)
    && values.length === expected.size
    && new Set(values).size === expected.size
    && values.every((value) => typeof value === "string" && expected.has(value));
}

function assertArchivePodCloseEventEnvelope(event, { demandKey, podId }) {
  if (
    event.actor !== "controller"
    || typeof event.eventId !== "string"
    || !event.eventId.startsWith("evt-pod-")
    || !Array.isArray(event.evidenceRefs)
    || event.evidenceRefs.length !== 0
    || !exactStringSet(event.allowedWrites, ARCHIVE_POD_CLOSE_WRITES)
    || !exactStringSet(
      event.forbiddenConclusions,
      ARCHIVE_POD_CLOSE_FORBIDDEN_CONCLUSIONS,
    )
    || (event.demandKey !== undefined && event.demandKey !== demandKey)
    || (event.podId !== undefined && event.podId !== podId)
  ) {
    fail(
      `archive-demand refuses invalid Pod close event ${event.eventId ?? "(unknown)"} `
      + `(${event.type ?? "unknown"}): its actor, authority identity, evidence, `
      + "or allowed-write boundary does not match the canonical Pod close reducer.",
    );
  }
}

function assertArchivePodCloseLifecycle(state, closeEvents) {
  const placement = state.executionPlacement;
  const provisioning = state.podProvisioning;
  const demandKey = state.demandKey;
  const podId = placement?.podId;
  if (
    placement?.mode !== "isolated"
    || placement?.selection !== "explicit-user-pod"
    || typeof podId !== "string"
    || !podId
    || typeof placement.authorizationRef !== "string"
    || !placement.authorizationRef
    || !provisioning
    || typeof provisioning !== "object"
    || Array.isArray(provisioning)
    || provisioning.podId !== podId
    || provisioning.authorizationRef !== placement.authorizationRef
  ) {
    fail(
      `archive-demand refuses terminal Pod close events for ${demandKey ?? "(unknown demand)"}: `
      + "executionPlacement and podProvisioning do not identify the same explicitly authorized Pod.",
    );
  }
  if (provisioning.phase !== "closed") {
    fail(
      `archive-demand refuses terminal Pod ${podId}: its close lifecycle ended at `
      + `${provisioning.phase ?? "(missing)"}, not closed.`,
    );
  }
  if (!Array.isArray(provisioning.windows)) {
    fail(`archive-demand refuses terminal Pod ${podId}: podProvisioning.windows is not an array.`);
  }
  const windowNames = provisioning.windows.map((window) => window?.windowName);
  const uniqueWindowNames = new Set(windowNames);
  if (
    windowNames.some((windowName) => typeof windowName !== "string" || !windowName)
    || uniqueWindowNames.size !== windowNames.length
    || provisioning.windows.some((window) => window?.status !== "closed")
  ) {
    fail(
      `archive-demand refuses terminal Pod ${podId}: every planned window must `
      + "have one unique identity and status=closed.",
    );
  }
  if (closeEvents.length === 0) {
    fail(
      `archive-demand refuses terminal Pod ${podId}: the event history has no `
      + "post-terminal Pod close lifecycle.",
    );
  }
  for (const event of closeEvents) {
    assertArchivePodCloseEventEnvelope(event, { demandKey, podId });
  }

  if (windowNames.length === 0) {
    const [closedEvent] = closeEvents;
    if (
      state.state !== "cancelled"
      || closeEvents.length !== 1
      || closedEvent.type !== "pod.closed"
      || closedEvent.to !== "closed"
      || (
        closedEvent.from !== null
        && !ARCHIVE_POD_PRE_CLOSE_PHASES.has(closedEvent.from)
      )
      || closedEvent.reason
        !== "cancelled Pod closed before any host launch operation was planned"
    ) {
      fail(
        `archive-demand refuses terminal Pod ${podId}: a zero-resource close `
        + "must contain exactly one canonical pod.closed event.",
      );
    }
    return;
  }

  const expectedEventCount = windowNames.length + 1;
  const [plannedEvent, ...receiptEvents] = closeEvents;
  if (
    closeEvents.length !== expectedEventCount
    || plannedEvent.type !== "pod.close-planned"
    || !ARCHIVE_POD_PRE_CLOSE_PHASES.has(plannedEvent.from)
    || plannedEvent.to !== "closing"
    || plannedEvent.reason
      !== "host close operations planned without physical resource mutation"
  ) {
    fail(
      `archive-demand refuses terminal Pod ${podId}: its close lifecycle must `
      + `start with one canonical pod.close-planned event and contain exactly `
      + `one receipt event for each of ${windowNames.length} planned windows.`,
    );
  }

  const receiptWindowNames = [];
  for (let index = 0; index < receiptEvents.length; index += 1) {
    const event = receiptEvents[index];
    const finalReceipt = index === receiptEvents.length - 1;
    const expectedType = finalReceipt ? "pod.closed" : "pod.window-logically-closed";
    const expectedTo = finalReceipt ? "closed" : "closing";
    if (
      event.type !== expectedType
      || event.from !== "closing"
      || event.to !== expectedTo
      || typeof event.reason !== "string"
      || !event.reason.startsWith(POD_CLOSE_RECEIPT_REASON_PREFIX)
    ) {
      fail(
        `archive-demand refuses terminal Pod ${podId}: receipt event `
        + `${event.eventId ?? "(unknown)"} does not follow the ordered `
        + `closing -> ${expectedTo} transition ending in one pod.closed event.`,
      );
    }
    const windowName = event.reason.slice(POD_CLOSE_RECEIPT_REASON_PREFIX.length);
    if (!uniqueWindowNames.has(windowName) || receiptWindowNames.includes(windowName)) {
      fail(
        `archive-demand refuses terminal Pod ${podId}: receipt event `
        + `${event.eventId ?? "(unknown)"} names an unknown or duplicate window ${windowName || "(missing)"}.`,
      );
    }
    receiptWindowNames.push(windowName);
  }
  if (
    receiptWindowNames.length !== windowNames.length
    || windowNames.some((windowName) => !receiptWindowNames.includes(windowName))
  ) {
    fail(
      `archive-demand refuses terminal Pod ${podId}: close receipts do not `
      + "cover the exact canonical Pod window set.",
    );
  }
}

function assertArchiveTerminalStateExplained(state, events) {
  const terminalType = state?.state === "completed"
    ? "demand.completed"
    : state?.state === "cancelled"
      ? "demand.cancelled"
      : null;
  if (!terminalType) {
    fail(`archive-demand requires state=completed or state=cancelled; ${state?.demandKey ?? "(unknown demand)"} is ${state?.state ?? "(missing)"}.`);
  }
  const stateRevision = Number(state.revision);
  const relevantEvents = events.filter((event) => Number(event?.stateRevision) <= stateRevision);
  let terminalIndex = -1;
  for (let index = relevantEvents.length - 1; index >= 0; index -= 1) {
    const event = relevantEvents[index];
    if (event?.type === terminalType && event?.to === state.state) {
      terminalIndex = index;
      break;
    }
  }
  if (terminalIndex < 0) {
    fail(
      `archive-demand refuses terminal state ${state.state} at revision ${state.revision}: `
      + `the controller event history has no matching ${terminalType} event. `
      + "Repair or recover the state/event authority before archiving.",
    );
  }
  const laterEvents = relevantEvents.slice(terminalIndex + 1);
  const invalidLaterEvent = laterEvents.find((event) => (
    !ARCHIVE_HOST_EVENTS_AFTER_TERMINAL.has(event?.type)
    && !ARCHIVE_POD_CLOSE_EVENTS_AFTER_TERMINAL.has(event?.type)
  ));
  if (invalidLaterEvent) {
    fail(
      `archive-demand refuses terminal state ${state.state}: controller event `
      + `${invalidLaterEvent.eventId ?? "(unknown)"} (${invalidLaterEvent.type ?? "unknown"}) `
      + "appears after the terminal event; only host-ownership events or the "
      + "canonical close lifecycle of that same Pod may follow before archival.",
    );
  }
  const closeEvents = laterEvents.filter((event) => (
    ARCHIVE_POD_CLOSE_EVENTS_AFTER_TERMINAL.has(event?.type)
  ));
  const isExplicitPod = (
    state.executionPlacement?.mode === "isolated"
    && state.executionPlacement?.selection === "explicit-user-pod"
  );
  if (closeEvents.length > 0 || (isExplicitPod && state.podProvisioning?.phase === "closed")) {
    assertArchivePodCloseLifecycle(state, closeEvents);
  }
}

function assertArchiveDirectory(file, label) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    throw new Error(`cannot inspect ${label} ${relative(file)}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a regular directory and cannot be a symbolic link: ${relative(file)}`);
  }
}

function copyArchiveTreeVerified(source, destination, label) {
  assertArchiveDirectory(source, `${label} source`);
  const sourceDigest = archiveTreeDigest(source);
  if (archivePathEntryExists(destination)) {
    assertArchiveDirectory(destination, label);
    const existingDigest = archiveTreeDigest(destination);
    if (!isDeepStrictEqual(existingDigest, sourceDigest)) {
      throw new Error(`${label} already exists but does not match the source tree: ${relative(destination)}`);
    }
    return { resumed: true, treeDigest: sourceDigest };
  }
  const staging = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    cpSync(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    const copiedDigest = archiveTreeDigest(staging);
    if (!isDeepStrictEqual(copiedDigest, sourceDigest)) {
      throw new Error(`${label} copy failed its full-tree integrity check`);
    }
    renameSync(staging, destination);
    return { resumed: false, treeDigest: sourceDigest };
  } catch (error) {
    if (archivePathEntryExists(staging)) {
      rmSync(staging, { recursive: true, force: true });
    }
    throw error;
  }
}

function detachAndRemoveArchivedSource(source, label) {
  const parent = path.dirname(source);
  const base = path.basename(source);
  let detached = path.join(parent, `.wakeflow-init-archive-finalize-${base}-${process.pid}-${Date.now()}`);
  for (let index = 2; archivePathEntryExists(detached); index += 1) {
    detached = path.join(parent, `.wakeflow-init-archive-finalize-${base}-${process.pid}-${Date.now()}-${index}`);
  }
  renameSync(source, detached);
  try {
    rmSync(detached, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    return null;
  } catch (error) {
    return `${label} was detached atomically but cleanup remains at ${relative(detached)}: ${error.message}`;
  }
}

function readArchivePendingIntent(stateRoot) {
  const file = archivePendingIntentFile(stateRoot);
  if (!existsSync(file)) return null;
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    fail(`cannot inspect archive intent ${relative(file)}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`archive intent must be a regular file and cannot be a symbolic link: ${relative(file)}`);
  }
  let intent;
  try {
    intent = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`invalid archive intent ${relative(file)}: ${error.message}`);
  }
  return intent;
}

function buildArchiveNextState(sourceState, { createdAt, reason }) {
  return {
    ...sourceState,
    state: "archived",
    stateReason: reason,
    revision: Number(sourceState.revision ?? 0) + 1,
    updatedAt: createdAt,
    allowedActions: [],
    decisionsRequired: [],
    projection: { ...(sourceState.projection ?? {}), status: "stale" },
  };
}

function buildArchiveEvent(sourceState, nextState, { createdAt, reason, evidenceRefs }) {
  return {
    eventId: nextEventId(createdAt, nextState.revision),
    createdAt,
    actor: "controller",
    type: "demand.archived",
    from: sourceState.state,
    to: "archived",
    reason,
    evidenceRefs,
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl"],
    forbiddenConclusions: ["archive-is-deletion", "archive-creates-dispatch", "archive-skips-redaction-audit"],
    stateRevision: nextState.revision,
  };
}

function archiveIntentAbsolutePath(relativePath, label, allowedRoot) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    fail(`${label} in archive intent must be a non-empty workspace-relative path.`);
  }
  const absolute = path.resolve(workspaceRoot, relativePath);
  if (relative(absolute) !== relativePath) {
    fail(`${label} in archive intent is not canonical: ${relativePath}`);
  }
  ensureInsideAllowedRoots(absolute, label, [allowedRoot]);
  return absolute;
}

function validateArchivePendingIntent({
  intent,
  stateRoot,
  state,
  events,
  reason,
  redact,
  allowOpaque,
  evidenceRefs,
  ledgerPaths,
}) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)
    || intent.kind !== "WakeflowArchivePendingIntent" || intent.version !== 1
    || intent.command !== "archive-demand") {
    fail(`archive intent ${relative(archivePendingIntentFile(stateRoot))} has an unsupported kind/version.`);
  }
  const commandArgs = { reason, redact, allowOpaque, evidenceRefs };
  const persistedCommandArgs = {
    ...intent.commandArgs,
    allowOpaque: Boolean(intent.commandArgs?.allowOpaque),
  };
  if (!isDeepStrictEqual(persistedCommandArgs, commandArgs)) {
    fail("archive-demand command arguments do not match the persisted archive intent; retry with the original --reason, --redact, --allow-opaque, and --evidence-ref values.");
  }
  if (typeof intent.createdAt !== "string" || !Number.isFinite(Date.parse(intent.createdAt))) {
    fail("archive intent createdAt is invalid.");
  }
  if (intent.sourceStateRoot !== relative(stateRoot)) {
    fail(`archive intent sourceStateRoot does not match the active root: ${intent.sourceStateRoot ?? "(missing)"}.`);
  }
  const sourceState = intent.sourceState;
  if (!sourceState || typeof sourceState !== "object" || Array.isArray(sourceState)
    || (sourceState.state !== "completed" && sourceState.state !== "cancelled")) {
    fail("archive intent sourceState must be the completed or cancelled state captured before archival.");
  }
  if (sourceState.demandKey !== state.demandKey) {
    fail(`archive intent demand ${sourceState.demandKey ?? "(missing)"} does not match active demand ${state.demandKey ?? "(missing)"}.`);
  }
  const expectedNextState = buildArchiveNextState(sourceState, {
    createdAt: intent.createdAt,
    reason: intent.commandArgs.reason,
  });
  const expectedEvent = buildArchiveEvent(sourceState, expectedNextState, {
    createdAt: intent.createdAt,
    reason: intent.commandArgs.reason,
    evidenceRefs: intent.commandArgs.evidenceRefs,
  });
  if (!isDeepStrictEqual(intent.nextState, expectedNextState)) {
    fail("archive intent nextState does not match its fixed source state, timestamp, and command arguments.");
  }
  if (!isDeepStrictEqual(intent.event, expectedEvent)) {
    fail("archive intent event does not match its fixed source state, timestamp, and command arguments.");
  }

  const expectedLedgerDest = path.join(
    ledgerPaths.workspaceArchiveDir,
    intent.createdAt.slice(0, 7),
    slug(sourceState.demandKey),
  );
  const ledgerDest = archiveIntentAbsolutePath(
    intent.ledgerDest,
    "archive intent ledger destination",
    ledgerPaths.workspaceArchiveDir,
  );
  if (path.resolve(ledgerDest) !== path.resolve(expectedLedgerDest)) {
    fail(`archive intent ledger destination does not match its fixed timestamp and demand: ${intent.ledgerDest}.`);
  }

  const preservedOriginal = intent.commandArgs.redact;
  let preservedDest = null;
  if (preservedOriginal) {
    const preservedRoot = path.join(workspaceRoot, ".wakeflow-local", "preserved");
    assertArchivePreservedBoundary(preservedRoot);
    preservedDest = archiveIntentAbsolutePath(
      intent.preservedDest,
      "archive intent preserved destination",
      preservedRoot,
    );
    if (path.dirname(preservedDest) !== path.resolve(preservedRoot)) {
      fail(`archive intent preserved destination must be a direct child of ${relative(preservedRoot)}.`);
    }
    const baseName = `${intent.createdAt.slice(0, 10)}-archive-original-${slug(sourceState.demandKey)}`;
    const actualName = path.basename(preservedDest);
    if (actualName !== baseName && !new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[2-9][0-9]*$`).test(actualName)) {
      fail(`archive intent preserved destination is not canonical for ${sourceState.demandKey}: ${intent.preservedDest}.`);
    }
  } else if (intent.preservedDest !== null) {
    fail("archive intent preservedDest must be null when --redact was not requested.");
  }

  if (!intent.archiveManifest || typeof intent.archiveManifest !== "object" || Array.isArray(intent.archiveManifest)) {
    fail("archive intent is missing its archive manifest.");
  }
  const manifest = intent.archiveManifest;
  if (manifest.kind !== "WakeflowArchiveManifest" || manifest.version !== 2
    || manifest.demandKey !== sourceState.demandKey
    || manifest.archivedAt !== intent.createdAt
    || manifest.reason !== intent.commandArgs.reason
    || manifest.sourceStateRoot !== intent.sourceStateRoot
    || manifest.preservedOriginal !== preservedOriginal
    || !isDeepStrictEqual(manifest.redactedFields, [])
    || (manifest.opaquePlaceholders !== undefined && !isDeepStrictEqual(manifest.opaquePlaceholders, []))
    || (manifest.pathPlaceholders !== undefined && !isDeepStrictEqual(manifest.pathPlaceholders, []))
    || (preservedOriginal ? manifest.originalPreservedAt !== intent.preservedDest : manifest.originalPreservedAt !== undefined)) {
    fail("archive intent manifest does not match its fixed source, destination, timestamp, and command arguments.");
  }
  if (!Array.isArray(intent.danglingRefs) || !intent.danglingRefs.every((value) => typeof value === "string")) {
    fail("archive intent danglingRefs must be an array of strings.");
  }
  if (intent.ledgerSnapshot !== null) {
    const snapshot = intent.ledgerSnapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
      || !snapshot.manifest || !snapshot.nextState || !snapshot.event
      || !validArchiveTreeDigest(snapshot.treeDigest)) {
      fail("archive intent ledgerSnapshot is invalid.");
    }
    if (snapshot.manifest.kind !== "WakeflowArchiveManifest"
      || snapshot.manifest.version !== 2
      || snapshot.manifest.demandKey !== sourceState.demandKey
      || snapshot.manifest.archivedAt !== intent.createdAt
      || snapshot.manifest.sourceStateRoot !== intent.sourceStateRoot
      || snapshot.manifest.preservedOriginal !== preservedOriginal
      || (preservedOriginal ? snapshot.manifest.originalPreservedAt !== intent.preservedDest : snapshot.manifest.originalPreservedAt !== undefined)
      || !Array.isArray(snapshot.manifest.redactedFields)
      || (snapshot.manifest.opaquePlaceholders !== undefined && !Array.isArray(snapshot.manifest.opaquePlaceholders))
      || (snapshot.manifest.pathPlaceholders !== undefined && !Array.isArray(snapshot.manifest.pathPlaceholders))) {
      fail("archive intent ledger manifest snapshot is inconsistent with the fixed archive intent.");
    }
    if (snapshot.nextState.state !== "archived"
      || snapshot.nextState.demandKey !== sourceState.demandKey
      || snapshot.nextState.revision !== intent.nextState.revision
      || snapshot.event.eventId !== intent.event.eventId
      || snapshot.event.createdAt !== intent.createdAt
      || snapshot.event.type !== "demand.archived"
      || snapshot.event.to !== "archived"
      || snapshot.event.stateRevision !== intent.nextState.revision) {
      fail("archive intent ledger state/event snapshot is inconsistent with the fixed archive intent.");
    }
  }

  let activePhase;
  if (isDeepStrictEqual(state, sourceState)) {
    activePhase = "source";
  } else if (isDeepStrictEqual(state, intent.nextState)) {
    const matchingEvents = events.filter((candidate) => candidate.eventId === intent.event.eventId);
    if (matchingEvents.length !== 1
      || !isDeepStrictEqual(matchingEvents[0], intent.event)
      || !isDeepStrictEqual(events.at(-1), intent.event)) {
      fail("active archived state does not have the exact archive event recorded by the archive intent.");
    }
    activePhase = "archived";
  } else {
    fail("active state does not match either the sourceState or nextState fixed by the archive intent; manual recovery is required.");
  }
  assertArchiveTerminalStateExplained(sourceState, events);
  return {
    sourceState,
    nextState: intent.nextState,
    event: intent.event,
    createdAt: intent.createdAt,
    ledgerDest,
    preservedDest,
    preservedOriginal,
    activePhase,
  };
}

function assertArchiveLedgerRegularPath(file, label, { directory = false } = {}) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    fail(`cannot inspect committed archive ${label} ${relative(file)}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    fail(`committed archive ${label} must be a ${directory ? "directory" : "regular file"} and cannot be a symbolic link: ${relative(file)}.`);
  }
}

function readArchiveLedgerSnapshot(ledgerDest) {
  assertArchiveLedgerRegularPath(ledgerDest, "root", { directory: true });
  const manifestFile = path.join(ledgerDest, "archive-manifest.json");
  const stateFile = path.join(ledgerDest, "wakeflow-state.json");
  const eventsFile = path.join(ledgerDest, "controller-events.jsonl");
  assertArchiveLedgerRegularPath(manifestFile, "manifest");
  assertArchiveLedgerRegularPath(stateFile, "state");
  assertArchiveLedgerRegularPath(eventsFile, "event log");
  const manifest = readJson(manifestFile, "committed archive manifest");
  const nextState = readJson(stateFile, "committed archived state");
  let events;
  try {
    events = readControllerEventsStrict(eventsFile);
  } catch (error) {
    fail(`committed archive event log is invalid: ${error.message}`);
  }
  if (events.length === 0) {
    fail("committed archive event log is empty.");
  }
  return {
    manifest,
    nextState,
    event: events.at(-1),
    events,
    treeDigest: archiveTreeDigest(ledgerDest),
  };
}

function assertCommittedArchiveMatchesIntent(ledgerDest, intent) {
  if (!intent.ledgerSnapshot) {
    fail("archive destination exists but the pending intent has no finalized ledger snapshot; refuse to overwrite or delete the ledger.");
  }
  const actual = readArchiveLedgerSnapshot(ledgerDest);
  const expected = intent.ledgerSnapshot;
  if (!isDeepStrictEqual(actual.manifest, expected.manifest)) {
    fail("committed archive manifest does not match the archive intent; refuse to overwrite or delete the ledger.");
  }
  if (!isDeepStrictEqual(actual.nextState, expected.nextState)) {
    fail("committed archived state does not match the archive intent; refuse to overwrite or delete the ledger.");
  }
  const eventMatches = actual.events.filter((candidate) => candidate.eventId === expected.event.eventId);
  if (eventMatches.length !== 1
    || !isDeepStrictEqual(actual.event, expected.event)
    || !isDeepStrictEqual(eventMatches[0], expected.event)) {
    fail("committed archive event does not match the archive intent; refuse to overwrite or delete the ledger.");
  }
  if (!isDeepStrictEqual(actual.treeDigest, expected.treeDigest)) {
    fail("committed archive tree does not match the archive intent; refuse to overwrite or delete the ledger.");
  }
  return expected;
}

function removeArchiveIntentFromStaging(stagingDest) {
  const file = path.join(stagingDest, ARCHIVE_PENDING_INTENT_FILE);
  if (existsSync(file)) rmSync(file, { recursive: true, force: true });
}

function withoutArchiveIntentRedactions(fields) {
  return (fields ?? []).filter((field) => field.file !== ARCHIVE_PENDING_INTENT_FILE);
}

// archive-demand: relocate a completed demand's state root into the committed ledger. The
// archive-privacy guard is a HARD precondition — it refuses on real-id-shaped strings and
// user/workspace absolute paths unless --redact relocates a portable cleaned COPY (the
// original is preserved in the gitignored active tier for a human audit). Dry-run unless
// --write. The archive copy is fully staged and re-scanned before the ledger is committed,
// so a filesystem or redaction failure cannot half-flip the active state root.
function commandArchiveDemand() {
  const stateRoot = stateRootFromArg();
  withLockedStateRoot(stateRoot, () => commandArchiveDemandLocked(stateRoot));
}

function commandArchiveDemandLocked(stateRoot) {
  const reason = requireValue("--reason");
  const redact = options.includes("--redact");
  const allowOpaque = options.includes("--allow-opaque");
  const evidenceRefs = valuesFor("--evidence-ref");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const pendingFile = archivePendingIntentFile(stateRoot);
  let archiveIntent = readArchivePendingIntent(stateRoot);
  const resumed = archiveIntent !== null;
  const intentCreatedThisRun = archiveIntent === null;
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  let sourceState;
  let nextState;
  let event;
  let createdAt;
  let ledgerDest;
  let preservedDest;
  let preservedOriginal;
  let activePhase;
  let scan;
  let findingCounts;
  let danglingRefs;

  // Archive relocates and (with --redact) rewrites the root — the most
  // destructive controller mutation, so it honors the same cross-host
  // fail-closed invariant as every other driving command.
  if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
    fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Archive it from the owning host or transfer ownership first (wakeflow_adopt_demand_host).`);
  }

  let controllerEvents;
  try {
    controllerEvents = readControllerEventsStrict(eventsFile);
  } catch (error) {
    fail(`cannot validate archive-demand against the active event log: ${error.message}`);
  }

  if (archiveIntent) {
    ({
      sourceState,
      nextState,
      event,
      createdAt,
      ledgerDest,
      preservedDest,
      preservedOriginal,
      activePhase,
    } = validateArchivePendingIntent({
      intent: archiveIntent,
      stateRoot,
      state,
      events: controllerEvents,
      reason,
      redact,
      allowOpaque,
      evidenceRefs,
      ledgerPaths,
    }));
    scan = archiveIntent.initialScan;
    if (!scan || typeof scan !== "object" || !Array.isArray(scan.findings) || typeof scan.clean !== "boolean") {
      fail("archive intent initialScan is invalid.");
    }
    findingCounts = archivePrivacyFindingCounts(scan.findings);
    danglingRefs = archiveIntent.danglingRefs;
  } else {
    assertArchiveTerminalStateExplained(state, controllerEvents);

    if (
      state.executionPlacement?.selection === "explicit-user-pod"
      && state.podProvisioning?.phase !== "closed"
    ) {
      fail(
        `archive-demand refuses: Pod ${state.executionPlacement.podId || state.demandKey} is ${state.podProvisioning?.phase || "untracked"}, not closed. Generate the host close plan and record every matching host close receipt before archiving; Wakeflow does not delete host worktrees itself.`,
      );
    }

    // A demand with live isolation worktree windows must not archive: their worktrees and
    // branches would orphan with no owner. Stream entries are plain config facts
    // (repositories[].stream, host-neutral) surfaced through the derived local
    // overlay that loadWorkspaceConfig already prefers.
    const openStreams = (config.repositories ?? [])
      .filter((repo) => repo?.stream?.demandKey === state.demandKey);
    if (openStreams.length > 0) {
      fail(`archive-demand refuses: ${openStreams.length} isolation worktree window(s) are still open for ${state.demandKey}: ${openStreams.map((repo) => repo.windowName).join(", ")}. Close them (stream-close) before archiving.`);
    }

    scan = scanStateRootForArchivePrivacy(stateRoot, {
      hostProfile,
      workspaceRoot,
      allowOpaque,
    });
    findingCounts = archivePrivacyFindingCounts(scan.findings);
    const sensitiveOpaqueFiles = new Set(scan.sensitiveOpaqueFiles ?? []);
    const opaqueBlockers = (scan.opaqueFiles ?? []).filter((item) => (
      !(redact && sensitiveOpaqueFiles.has(item.file))
    ));
    if (opaqueBlockers.length > 0 && !allowOpaque && !redact) {
      fail(
        `archive-demand refuses ${opaqueBlockers.length} opaque file(s); inspect their recorded sha256 values, then retry with --allow-opaque to preserve those exact bytes or --redact to keep them only in the local preserved original.`,
      );
    }
    if (!scan.clean && !redact) {
      fail([
        `archive-demand refuses: ${scan.findings.length} archive privacy finding(s) in the state-root tree (${JSON.stringify(findingCounts)}).`,
        "Audit them, then re-run with --redact to relocate a cleaned COPY (original preserved for audit).",
        ...scan.findings.slice(0, 5).map((finding) => `  [${finding.kind ?? "unknown"}] ${finding.file ?? "?"}:${finding.line ?? "?"} ${finding.match ?? finding.reason ?? ""}`),
      ].join("\n"));
    }

    sourceState = state;
    createdAt = nowIso();
    ledgerDest = path.join(
      ledgerPaths.workspaceArchiveDir,
      createdAt.slice(0, 7),
      slug(sourceState.demandKey),
    );
    ensureInsideAllowedRoots(ledgerDest, "archive destination", [ledgerPaths.workspaceArchiveDir]);
    if (existsSync(ledgerDest)) {
      fail(`archive destination already exists: ${relative(ledgerDest)}; refuse to overwrite.`);
    }
    preservedOriginal = redact;
    preservedDest = null;
    if (preservedOriginal) {
      const preservedRoot = path.join(workspaceRoot, ".wakeflow-local", "preserved");
      assertArchivePreservedBoundary(preservedRoot);
      const baseName = `${createdAt.slice(0, 10)}-archive-original-${slug(sourceState.demandKey)}`;
      preservedDest = path.join(preservedRoot, baseName);
      for (let n = 2; archivePathEntryExists(preservedDest); n += 1) {
        preservedDest = path.join(preservedRoot, `${baseName}-${n}`);
      }
    }
    nextState = buildArchiveNextState(sourceState, { createdAt, reason });
    event = buildArchiveEvent(sourceState, nextState, { createdAt, reason, evidenceRefs });
    activePhase = "source";
    danglingRefs = scanDanglingEnvelopeRefs(stateRoot);
  }

  if (!write) {
    output({
      ok: true,
      command: "archive-demand",
      wrote: false,
      wouldArchive: {
        demandKey: sourceState.demandKey,
        sourceStateRoot: relative(stateRoot),
        ledgerDest: relative(ledgerDest),
        redactNeeded: !scan.clean,
        findingCount: scan.findings.length,
        findingCounts,
        findings: scan.findings.slice(0, 10),
        danglingRefs,
        resumed,
        activePhase,
      },
      forbiddenConclusions: ["archive-is-deletion", "archive-is-acceptance"],
      agentNext: resumed
        ? "Dry-run only. Re-run the same archive-demand command with --write to resume the persisted archive intent."
        : scan.clean
        ? "Dry-run only. Re-run with --write to flip the demand to archived and relocate it into the committed ledger."
        : "Dry-run only. Archive privacy findings found — audit them, then re-run with --redact --write to relocate a cleaned copy.",
    }, [`Would ${resumed ? "resume archive" : "archive"} ${sourceState.demandKey} -> ${relative(ledgerDest)}${scan.clean ? "" : " (redaction required)"}`]);
    return;
  }

  let redactedFields = [];
  let opaquePlaceholders = [];
  let pathPlaceholders = [];
  // Archive spine: thread the whole demand story into the manifest so the
  // archived tree is navigable without archaeology — provenance (design key +
  // source docs), the completion conclusion, the per-task handling rollup,
  // and the test cards.
  const demandFile = path.join(stateRoot, "demand.json");
  const demandRecord = existsSync(demandFile) ? JSON.parse(readFileSync(demandFile, "utf8")) : {};
  if (sourceState.demandType && demandRecord.demandType && sourceState.demandType !== demandRecord.demandType) {
    fail(`controller state demandType ${sourceState.demandType} does not match immutable demand type ${demandRecord.demandType}.`);
  }
  let archivedDemandAuthority = null;
  let archivedDemandAuthorityDigest = null;
  if (!sourceState.demandAuthorityRef && existsSync(path.join(stateRoot, DEMAND_AUTHORITY_FILE))) {
    fail(`unreferenced ${DEMAND_AUTHORITY_FILE} already exists; refuse to archive ambiguous demand authority.`);
  }
  if (sourceState.demandAuthorityRef) {
    if (sourceState.demandAuthorityRef !== DEMAND_AUTHORITY_FILE) {
      fail(`controller state demandAuthorityRef must equal ${DEMAND_AUTHORITY_FILE}.`);
    }
    if (!sourceState.demandAuthorityDigest) {
      fail(`controller state is missing the frozen demandAuthorityDigest for ${DEMAND_AUTHORITY_FILE}.`);
    }
    const authorityFile = path.join(stateRoot, DEMAND_AUTHORITY_FILE);
    if (!existsSync(authorityFile)) {
      fail(`controller state references missing ${DEMAND_AUTHORITY_FILE}.`);
    }
    let readiness;
    try {
      readiness = assertDemandAuthorityReady(readJson(authorityFile, "demand authority"), {
        workspaceRoot,
        demandKey: sourceState.demandKey,
        demandType: demandRecord.demandType ?? sourceState.demandType ?? null,
        expectedDigest: sourceState.demandAuthorityDigest,
      });
    } catch (error) {
      fail(`cannot archive invalid demand authority: ${error.message}`);
    }
    archivedDemandAuthority = readiness.authority;
    archivedDemandAuthorityDigest = readiness.digest;
  }
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
  const taskLedger = (sourceState.targetTasks ?? []).map((task) => ({
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
  const computedArchiveManifest = {
    kind: "WakeflowArchiveManifest",
    version: 2,
    demandKey: sourceState.demandKey,
    title: sourceState.title ?? demandRecord.title ?? null,
    archivedAt: createdAt,
    reason,
    redactedFields: [],
    opaquePlaceholders: [],
    pathPlaceholders: [],
    sourceStateRoot: relative(stateRoot),
    preservedOriginal,
    ...(preservedOriginal ? { originalPreservedAt: relative(preservedDest) } : {}),
    designKey: demandRecord.source?.designKey ?? null,
    sourceDocuments: demandRecord.source?.documents ?? [],
    demandType: archivedDemandAuthority?.demandType ?? demandRecord.demandType ?? null,
    demandAuthority: archivedDemandAuthority ? {
      ref: DEMAND_AUTHORITY_FILE,
      digest: archivedDemandAuthorityDigest,
      entryMode: archivedDemandAuthority.entryMode,
      testDecision: archivedDemandAuthority.testDecision,
      authorityRefs: archivedDemandAuthority.authorityRefs,
    } : null,
    opaqueFiles: scan.opaqueFiles ?? [],
    conclusion,
    taskLedger,
    testCards,
  };
  const archiveManifest = {
    ...(archiveIntent?.archiveManifest ?? computedArchiveManifest),
    redactedFields: [],
    opaquePlaceholders: archiveIntent?.archiveManifest?.opaquePlaceholders ?? [],
    pathPlaceholders: archiveIntent?.archiveManifest?.pathPlaceholders ?? [],
  };
  if (!archiveIntent) {
    archiveIntent = {
      kind: "WakeflowArchivePendingIntent",
      version: 1,
      command: "archive-demand",
      createdAt,
      sourceStateRoot: relative(stateRoot),
      ledgerDest: relative(ledgerDest),
      preservedDest: preservedDest ? relative(preservedDest) : null,
      commandArgs: { reason, redact, allowOpaque, evidenceRefs },
      sourceState,
      event,
      nextState,
      archiveManifest: computedArchiveManifest,
      initialScan: scan,
      danglingRefs,
      ledgerSnapshot: null,
    };
    writeJson(pendingFile, archiveIntent);
  }
  const stagingDest = `${ledgerDest}.tmp-${process.pid}-${Date.now()}`;

  if (existsSync(ledgerDest)) {
    const committedSnapshot = assertCommittedArchiveMatchesIntent(ledgerDest, archiveIntent);
    redactedFields = committedSnapshot.manifest.redactedFields;
    opaquePlaceholders = committedSnapshot.manifest.opaquePlaceholders ?? [];
    pathPlaceholders = committedSnapshot.manifest.pathPlaceholders ?? [];
  } else {
    if (activePhase !== "source") {
      fail("archive intent says the active state is already archived, but its fixed ledger destination is missing; manual recovery is required.");
    }
    try {
      mkdirSync(path.dirname(ledgerDest), { recursive: true });
      if (redact) {
        ({ redactedFields, opaquePlaceholders, pathPlaceholders } = redactStateRootIntoCopy(stateRoot, stagingDest, {
          hostProfile,
          workspaceRoot,
          allowOpaque,
        }));
        redactedFields = withoutArchiveIntentRedactions(redactedFields);
        archiveManifest.redactedFields = redactedFields;
        archiveManifest.opaquePlaceholders = opaquePlaceholders;
        archiveManifest.pathPlaceholders = pathPlaceholders;
      } else {
        cpSync(stateRoot, stagingDest, { recursive: true });
      }
      removeArchiveIntentFromStaging(stagingDest);
    // Append only inside the staged copy. A failed archive must not leave a
    // false "archived" line in the still-active human progress document.
      appendProgressTimeline(stagingDest, sourceState, PROGRESS_SECTIONS.decisions,
      `${createdAt} archived → ${relative(ledgerDest)} — ${reason}`);
      appendJsonLine(path.join(stagingDest, "controller-events.jsonl"), event);
      writeJson(path.join(stagingDest, "wakeflow-state.json"), nextState);
      writeJson(path.join(stagingDest, "archive-manifest.json"), archiveManifest);
    // The human one-pager: the archived story in reading order — requirement
    // provenance, conclusion, per-task handling, tests, execution timeline
    // pointer, audit-hold pointer.
    writeText(path.join(stagingDest, "archive-summary.md"), [
      `# ${sourceState.demandKey} — Archive Summary`,
      "",
      `- Title: ${archiveManifest.title ?? sourceState.demandKey}`,
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
      `- Demand type: ${archiveManifest.demandType ?? "(legacy / not recorded)"}`,
      ...(archiveManifest.demandAuthority
        ? [
            `- Demand authority: ${archiveManifest.demandAuthority.ref}`,
            `- Demand authority digest: ${archiveManifest.demandAuthority.digest}`,
            `- Testing decision: ${archiveManifest.demandAuthority.testDecision.mode} — ${archiveManifest.demandAuthority.testDecision.summary}`,
          ]
        : ["- Demand authority: (legacy / not recorded)"]),
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
      `- Opaque evidence placeholders: ${opaquePlaceholders.length ? `${opaquePlaceholders.length} (see archive-manifest.json opaquePlaceholders)` : "none"}`,
      `- Sensitive path placeholders: ${pathPlaceholders.length ? `${pathPlaceholders.length} (see archive-manifest.json pathPlaceholders)` : "none"}`,
      "",
    ].join("\n"));
      let stagedScan = scanStateRootForArchivePrivacy(stagingDest, {
        hostProfile,
        workspaceRoot,
        allowOpaque,
      });
      if (!stagedScan.clean && redact) {
        // Generated manifest/summary/event content is written after the first
        // copy, so sanitize the complete staged tree once more. This closes the
        // gap where a reason or evidence ref introduces a path that was absent
        // from the original state root.
        const restagingDest = `${stagingDest}.sanitized`;
        const secondPass = redactStateRootIntoCopy(stagingDest, restagingDest, {
          hostProfile,
          workspaceRoot,
          allowOpaque,
        });
        redactedFields = mergeRedactedFields(redactedFields, secondPass.redactedFields);
        opaquePlaceholders = mergeOpaquePlaceholders(opaquePlaceholders, secondPass.opaquePlaceholders);
        pathPlaceholders = mergePathPlaceholders(pathPlaceholders, secondPass.pathPlaceholders);
        rmSync(stagingDest, { recursive: true, force: true });
        renameSync(restagingDest, stagingDest);
        const sanitizedManifest = readJson(path.join(stagingDest, "archive-manifest.json"), "sanitized archive manifest");
        writeJson(path.join(stagingDest, "archive-manifest.json"), {
          ...sanitizedManifest,
          redactedFields,
          opaquePlaceholders,
          pathPlaceholders,
        });
        stagedScan = scanStateRootForArchivePrivacy(stagingDest, {
          hostProfile,
          workspaceRoot,
          allowOpaque,
        });
      }
      if (!stagedScan.clean) {
        const stagedCounts = archivePrivacyFindingCounts(stagedScan.findings);
        throw new WakeflowArchiveStagedPrivacyError(
          `staged archive failed the final privacy scan (${JSON.stringify(stagedCounts)}): ${stagedScan.findings.slice(0, 3).map((finding) => `${finding.file ?? "?"}:${finding.line ?? "?"}`).join(", ")}`,
        );
      }
      const stagedManifest = JSON.parse(readFileSync(path.join(stagingDest, "archive-manifest.json"), "utf8"));
      const stagedState = JSON.parse(readFileSync(path.join(stagingDest, "wakeflow-state.json"), "utf8"));
      const stagedEvents = readControllerEventsStrict(path.join(stagingDest, "controller-events.jsonl"));
      const stagedEvent = stagedEvents.at(-1);
      const matchingArchiveEvents = stagedEvents.filter((candidate) => candidate.eventId === event.eventId);
      if (stagedState.state !== "archived"
        || stagedState.demandKey !== sourceState.demandKey
        || stagedState.revision !== nextState.revision
        || matchingArchiveEvents.length !== 1
        || stagedEvent?.eventId !== event.eventId
        || stagedEvent?.stateRevision !== nextState.revision
        || stagedEvent?.type !== "demand.archived") {
        throw new Error("staged archive state/event does not match the fixed archive intent");
      }
      const ledgerSnapshot = {
        manifest: stagedManifest,
        nextState: stagedState,
        event: stagedEvent,
        treeDigest: archiveTreeDigest(stagingDest),
      };
      if (archiveIntent.ledgerSnapshot && !isDeepStrictEqual(archiveIntent.ledgerSnapshot, ledgerSnapshot)) {
        throw new Error("restaged archive does not match the finalized ledger snapshot in the archive intent");
      }
      if (!archiveIntent.ledgerSnapshot) {
        archiveIntent = { ...archiveIntent, ledgerSnapshot };
        writeJson(pendingFile, archiveIntent);
      }
      renameSync(stagingDest, ledgerDest);
    } catch (error) {
      if (existsSync(stagingDest)) rmSync(stagingDest, { recursive: true, force: true });
      let intentDisposition = "its archive intent was retained";
      if (error instanceof WakeflowArchiveStagedPrivacyError
        && intentCreatedThisRun
        && activePhase === "source"
        && !archivePathEntryExists(ledgerDest)) {
        try {
          const currentIntent = readArchivePendingIntent(stateRoot);
          if (isDeepStrictEqual(currentIntent, archiveIntent)) {
            unlinkSync(pendingFile);
            intentDisposition = "the newly created archive intent was removed so the command can be retried with --redact";
          }
        } catch (cleanupError) {
          intentDisposition = `its archive intent was retained because cleanup failed: ${cleanupError.message}`;
        }
      }
      fail(`archive-demand failed before ledger commit; active state authority was left unchanged and ${intentDisposition}: ${error.message}`);
    }
  }

  let originalPreservedAt = null;
  let originalPreserveWarning = null;
  let activeCleanupWarning = null;
  if (preservedOriginal) {
    if (activePhase === "source") {
      try {
        commitStateTransition({
          stateRoot,
          stateFile,
          eventsFile,
          event,
          nextState,
          command: "archive-demand",
        });
        activePhase = "archived";
      } catch (error) {
        fail(`archive-demand committed ledger at ${relative(ledgerDest)} but could not record its fixed active state/event: ${error.message}`);
      }
    }

    // Canonical audit hold: move the un-redacted original OUT of current/.
    // The destination was selected once in the archive intent, and the
    // committed manifest already carries that exact relative pointer.
    const preservedRoot = path.dirname(preservedDest);
    assertArchivePreservedBoundary(preservedRoot);
    try {
      mkdirSync(preservedRoot, { recursive: true });
      writeFileSync(path.join(stateRoot, "MANIFEST.md"), [
        `# Preserved: ${path.basename(preservedDest)}`,
        "",
        `- Preserved at: ${createdAt}`,
        `- Source: ${relative(stateRoot)}`,
        `- Reason: un-redacted original of archived demand ${sourceState.demandKey} (redacted copy committed at ${relative(ledgerDest)})`,
        "- Preserved by: archive-demand --redact",
        "- Retention: audit hold; prune-preserved lists it once aged past preservedRetentionDays",
        "",
      ].join("\n"));
      copyArchiveTreeVerified(stateRoot, preservedDest, "archive preserved original");
      activeCleanupWarning = detachAndRemoveArchivedSource(
        stateRoot,
        "archived active source",
      );
      originalPreservedAt = relative(preservedDest);
      try {
        unlinkSync(path.join(preservedDest, ARCHIVE_PENDING_INTENT_FILE));
      } catch (error) {
        originalPreserveWarning = `preserved original still contains ${ARCHIVE_PENDING_INTENT_FILE}: ${error.message}`;
      }
    } catch (error) {
      fail(`archive-demand committed ledger at ${relative(ledgerDest)} but could not copy and finalize the archived active root at its fixed preserved destination ${relative(preservedDest)}; retry the same command after fixing the destination: ${error.message}`);
    }
  } else {
    try {
      // Non-redacted archives commit a complete copy, so removing the active
      // root also removes the persisted archive intent.
      activeCleanupWarning = detachAndRemoveArchivedSource(
        stateRoot,
        "archived active source",
      );
    } catch (error) {
      fail(`archive-demand committed ledger at ${relative(ledgerDest)} but could not finalize the active state root: ${error.message}`);
    }
  }

  const todoArchive = archiveWorkspaceTodo({
    workspaceRoot,
    config,
    designKey: sourceState.designKey ?? demandRecord.designKey ?? demandRecord.source?.designKey,
    archiveMount: relative(ledgerDest),
    // The board must not report a cancelled demand as delivered.
    rowStatus: sourceState.state === "cancelled" ? "cancelled / archived" : "completed / archived",
  });
  refreshWorkspaceProjection({ workspaceRoot, config, updatedAt: createdAt });
  const archiveWarnings = [
    originalPreserveWarning,
    activeCleanupWarning,
    todoArchive.reason && !["no-design-key", "row-missing"].includes(todoArchive.reason)
      ? `Global TODO archive projection was not updated: ${todoArchive.reason}`
      : null,
  ].filter(Boolean);

  output({
    ok: true,
    command: "archive-demand",
    wrote: true,
    archived: {
      demandKey: sourceState.demandKey,
      ledgerDest: relative(ledgerDest),
      manifest: relative(path.join(ledgerDest, "archive-manifest.json")),
      redactedFields,
      opaquePlaceholders,
      pathPlaceholders,
      preservedOriginal,
      originalPreservedAt,
      danglingRefs,
      todoArchive,
      resumed,
    },
    ...(archiveWarnings.length ? { warnings: archiveWarnings } : {}),
    indexRefreshNeeded: false,
    forbiddenConclusions: ["archive-is-deletion", "archive-is-acceptance"],
    agentNext: "The active workspace projection was refreshed. Review redactedFields before committing the ledger to git.",
  }, [
    `Archived ${sourceState.demandKey} -> ${relative(ledgerDest)}`,
    redactedFields.length
      ? `Redacted ${redactedFields.reduce((total, field) => total + field.count, 0)} sensitive value(s) into the committed copy; original preserved for audit${originalPreservedAt ? ` at ${originalPreservedAt}` : ""}.`
      : "No redaction needed.",
    danglingRefs.length ? `WARNING: ${danglingRefs.length} delivery envelope(s) still reference the old path.` : "",
  ].filter(Boolean));
}

// sanitize-archive is deliberately narrower than archive-demand. It can only
// amend an existing archived demand in the configured project ledger, never an
// active state root. The original archived bytes move to the gitignored
// preserved tier by verified copy, while a fully sanitized/re-scanned replacement keeps the
// same durable archive path and appends an audit event.
function assertSanitizeArchiveBoundary(stateRoot, archiveRoot) {
  const canonicalArchiveRoot = realPathWithMissingTail(path.resolve(archiveRoot));
  const canonicalStateRoot = realPathWithMissingTail(path.resolve(stateRoot));
  const archiveRelative = path.relative(canonicalArchiveRoot, canonicalStateRoot);
  if (!archiveRelative
    || archiveRelative.startsWith("..")
    || path.isAbsolute(archiveRelative)) {
    fail(`sanitize-archive accepts only an existing demand root below ${relative(archiveRoot)}; got ${relative(stateRoot)}.`);
  }
}

function commandSanitizeArchive() {
  const stateRoot = stateRootFromArg();
  const config = loadWorkspaceConfig({ workspaceRoot, args: options });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, args: options, config });
  assertSanitizeArchiveBoundary(stateRoot, ledgerPaths.workspaceArchiveDir);
  withLockedStateRoot(
    stateRoot,
    () => commandSanitizeArchiveLocked(stateRoot),
  );
}

function commandSanitizeArchiveLocked(stateRoot) {
  const reason = requireValue("--reason");
  const allowOpaque = options.includes("--allow-opaque");

  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const manifestFile = path.join(stateRoot, "archive-manifest.json");
  const state = readJson(stateFile, "archived controller state");
  if (state.state !== "archived") {
    fail(`sanitize-archive requires state=archived; ${state.demandKey ?? relative(stateRoot)} is ${state.state}.`);
  }
  if (!existsSync(manifestFile)) {
    fail(`sanitize-archive requires archive-manifest.json: ${relative(manifestFile)}.`);
  }
  const manifest = readJson(manifestFile, "archive manifest");
  const scan = scanStateRootForArchivePrivacy(stateRoot, {
    hostProfile,
    workspaceRoot,
    allowOpaque,
  });
  const findingCounts = archivePrivacyFindingCounts(scan.findings);
  if (scan.clean) {
    output({
      ok: true,
      command: "sanitize-archive",
      wrote: false,
      alreadyClean: true,
      stateRoot: relative(stateRoot),
      findingCount: 0,
      findingCounts,
      agentNext: "The archived demand already passes the archive privacy scan; no files were changed.",
    }, [`Archive already clean: ${relative(stateRoot)}`]);
    return;
  }

  if (!write) {
    output({
      ok: true,
      command: "sanitize-archive",
      wrote: false,
      wouldSanitize: {
        demandKey: state.demandKey,
        stateRoot: relative(stateRoot),
        findingCount: scan.findings.length,
        findingCounts,
        findings: scan.findings.slice(0, 10),
      },
      agentNext: "Dry-run only. Review the categorized findings, then re-run with --write to replace the archive with a clean copy while preserving the original under .wakeflow-local/preserved/.",
    }, [`Would sanitize ${relative(stateRoot)} (${scan.findings.length} finding(s))`]);
    return;
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const stagingDest = `${stateRoot}.sanitize-tmp-${process.pid}-${Date.now()}`;
  const preservedRoot = path.join(workspaceRoot, ".wakeflow-local", "preserved");
  assertArchivePreservedBoundary(preservedRoot);
  const dateSlug = createdAt.slice(0, 10);
  let preservedDest = path.join(preservedRoot, `${dateSlug}-archive-sanitization-original-${slug(state.demandKey)}`);
  for (let n = 2; archivePathEntryExists(preservedDest); n += 1) {
    preservedDest = path.join(preservedRoot, `${dateSlug}-archive-sanitization-original-${slug(state.demandKey)}-${n}`);
  }
  const originalPreservedAt = relative(preservedDest);
  const event = {
    eventId: nextEventId(createdAt, nextRevision),
    createdAt,
    actor: "controller",
    type: "archive.sanitized",
    from: "archived",
    to: "archived",
    reason,
    evidenceRefs: [],
    allowedWrites: ["wakeflow-state.json", "controller-events.jsonl", "archive-manifest.json", "archive-summary.md"],
    forbiddenConclusions: ["archive-sanitization-reopens-demand", "archive-sanitization-changes-acceptance"],
    stateRevision: nextRevision,
  };
  const nextState = {
    ...state,
    revision: nextRevision,
    updatedAt: createdAt,
  };

  let redactedFields = [];
  let opaquePlaceholders = [];
  let pathPlaceholders = [];
  try {
    ({ redactedFields, opaquePlaceholders, pathPlaceholders } = redactStateRootIntoCopy(stateRoot, stagingDest, {
      hostProfile,
      workspaceRoot,
      allowOpaque,
    }));
    const historyEntry = {
      sanitizedAt: createdAt,
      reason,
      source: "sanitize-archive",
      findingCounts,
      redactedFields,
      opaquePlaceholders,
      pathPlaceholders,
      originalPreservedAt,
    };
    const nextManifest = {
      ...manifest,
      version: Math.max(Number(manifest.version ?? 2), 3),
      redactedFields: mergeRedactedFields(manifest.redactedFields ?? [], redactedFields),
      opaquePlaceholders: mergeOpaquePlaceholders(manifest.opaquePlaceholders ?? [], opaquePlaceholders),
      pathPlaceholders: mergePathPlaceholders(manifest.pathPlaceholders ?? [], pathPlaceholders),
      sanitizationHistory: [...(Array.isArray(manifest.sanitizationHistory) ? manifest.sanitizationHistory : []), historyEntry],
      sanitizationOriginalPreservedAt: originalPreservedAt,
    };
    appendJsonLine(path.join(stagingDest, "controller-events.jsonl"), event);
    writeJson(path.join(stagingDest, "wakeflow-state.json"), nextState);
    writeJson(path.join(stagingDest, "archive-manifest.json"), nextManifest);
    const summaryFile = path.join(stagingDest, "archive-summary.md");
    const existingSummary = existsSync(summaryFile)
      ? readFileSync(summaryFile, "utf8").trimEnd()
      : `# ${state.demandKey} — Archive Summary`;
    writeText(summaryFile, [
      existingSummary,
      "",
      "## Sanitization Amendments",
      "",
      `- ${createdAt}: archive privacy findings removed — ${reason}`,
      `- Original preserved at: ${originalPreservedAt}`,
    ].join("\n"));

    let stagedScan = scanStateRootForArchivePrivacy(stagingDest, {
      hostProfile,
      workspaceRoot,
      allowOpaque,
    });
    if (!stagedScan.clean) {
      const restagingDest = `${stagingDest}.sanitized`;
      const secondPass = redactStateRootIntoCopy(stagingDest, restagingDest, {
        hostProfile,
        workspaceRoot,
        allowOpaque,
      });
      redactedFields = mergeRedactedFields(redactedFields, secondPass.redactedFields);
      opaquePlaceholders = mergeOpaquePlaceholders(opaquePlaceholders, secondPass.opaquePlaceholders);
      pathPlaceholders = mergePathPlaceholders(pathPlaceholders, secondPass.pathPlaceholders);
      rmSync(stagingDest, { recursive: true, force: true });
      renameSync(restagingDest, stagingDest);
      const sanitizedManifest = readJson(path.join(stagingDest, "archive-manifest.json"), "sanitized archive manifest");
      const sanitizedHistory = Array.isArray(sanitizedManifest.sanitizationHistory)
        ? sanitizedManifest.sanitizationHistory
        : [];
      const finalizedManifest = {
        ...sanitizedManifest,
        redactedFields: mergeRedactedFields(sanitizedManifest.redactedFields ?? [], redactedFields),
        opaquePlaceholders: mergeOpaquePlaceholders(sanitizedManifest.opaquePlaceholders ?? [], opaquePlaceholders),
        pathPlaceholders: mergePathPlaceholders(sanitizedManifest.pathPlaceholders ?? [], pathPlaceholders),
        sanitizationHistory: sanitizedHistory.map((entry, index) => (
          index === sanitizedHistory.length - 1 ? {
            ...entry,
            redactedFields,
            opaquePlaceholders,
            pathPlaceholders,
          } : entry
        )),
      };
      writeJson(path.join(stagingDest, "archive-manifest.json"), finalizedManifest);
      stagedScan = scanStateRootForArchivePrivacy(stagingDest, {
        hostProfile,
        workspaceRoot,
        allowOpaque,
      });
    }
    if (!stagedScan.clean) {
      throw new Error(`sanitized archive failed the final privacy scan (${JSON.stringify(archivePrivacyFindingCounts(stagedScan.findings))}).`);
    }
  } catch (error) {
    if (existsSync(stagingDest)) rmSync(stagingDest, { recursive: true, force: true });
    fail(`sanitize-archive failed before replacement; archived root was left unchanged: ${error.message}`);
  }

  assertArchivePreservedBoundary(preservedRoot);
  if (archivePathEntryExists(preservedDest)) {
    fail(`sanitize-archive fixed preserved destination already exists: ${relative(preservedDest)}; refuse to overwrite.`);
  }
  let preservedCreated = false;
  try {
    mkdirSync(preservedRoot, { recursive: true });
    copyArchiveTreeVerified(
      stateRoot,
      preservedDest,
      "archive sanitization preserved original",
    );
    preservedCreated = true;
    writeFileSync(path.join(preservedDest, "MANIFEST.md"), [
      `# Preserved: ${path.basename(preservedDest)}`,
      "",
      `- Preserved at: ${createdAt}`,
      `- Source: ${relative(stateRoot)}`,
      `- Reason: pre-sanitization original of archived demand ${state.demandKey}`,
      "- Preserved by: sanitize-archive",
      "- Retention: audit hold; prune-preserved lists it once aged past preservedRetentionDays",
      "",
    ].join("\n"));
  } catch (error) {
    if (preservedCreated && archivePathEntryExists(preservedDest)) {
      rmSync(preservedDest, { recursive: true, force: true });
    }
    if (existsSync(stagingDest)) rmSync(stagingDest, { recursive: true, force: true });
    fail(`sanitize-archive could not preserve ${relative(stateRoot)}; the archived root was left unchanged: ${error.message}`);
  }

  const originalDetached = path.join(
    path.dirname(stateRoot),
    `.wakeflow-sanitize-original-${path.basename(stateRoot)}-${process.pid}-${Date.now()}`,
  );
  let detached = false;
  try {
    renameSync(stateRoot, originalDetached);
    detached = true;
    // stagingDest and stateRoot are siblings on the same filesystem. The only
    // cross-device transfer is the verified copy into the preserved tier.
    renameSync(stagingDest, stateRoot);
  } catch (error) {
    let rollbackError = null;
    let preserveCleanupError = null;
    if (detached && !existsSync(stateRoot) && archivePathEntryExists(originalDetached)) {
      try {
        renameSync(originalDetached, stateRoot);
        detached = false;
      } catch (recoveryError) {
        rollbackError = recoveryError;
      }
    }
    if (!detached && archivePathEntryExists(preservedDest)) {
      try {
        rmSync(preservedDest, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch (cleanupError) {
        preserveCleanupError = cleanupError;
      }
    }
    if (existsSync(stagingDest)) rmSync(stagingDest, { recursive: true, force: true });
    fail(
      `sanitize-archive could not replace ${relative(stateRoot)}`
      + `${detached
        ? ` and the detached original remains at ${relative(originalDetached)}`
        : "; the archived root was restored"}: `
      + `${error.message}${rollbackError ? `; rollback failed: ${rollbackError.message}` : ""}`
      + `${preserveCleanupError ? `; preserved-copy cleanup failed: ${preserveCleanupError.message}` : ""}`,
    );
  }

  let cleanupWarning = null;
  try {
    rmSync(originalDetached, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch (error) {
    cleanupWarning = `sanitized archive replacement committed, but detached original cleanup remains at ${relative(originalDetached)}: ${error.message}`;
  }

  output({
    ok: true,
    command: "sanitize-archive",
    wrote: true,
    sanitized: {
      demandKey: state.demandKey,
      stateRoot: relative(stateRoot),
      findingCount: scan.findings.length,
      findingCounts,
      redactedFields,
      opaquePlaceholders,
      pathPlaceholders,
      originalPreservedAt,
      stateRevision: nextRevision,
    },
    ...(cleanupWarning ? { warnings: [cleanupWarning] } : {}),
    forbiddenConclusions: ["archive-sanitization-reopens-demand", "archive-sanitization-changes-acceptance"],
    agentNext: "The archive was replaced in place with a privacy-clean copy. Review the manifest amendment and preserved-original pointer before committing.",
  }, [`Sanitized archive ${relative(stateRoot)}; original preserved at ${originalPreservedAt}`]);
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
    case "recover-state-transition":
      commandRecoverStateTransition();
      break;
    case "decide-review":
      commandDecideReview();
      break;
    case "complete-demand":
      commandCompleteDemand();
      break;
    case "continue-demand":
      commandContinueDemand();
      break;
    case "cancel-demand":
      commandCancelDemand();
      break;
    case "archive-demand":
      commandArchiveDemand();
      break;
    case "sanitize-archive":
      commandSanitizeArchive();
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
