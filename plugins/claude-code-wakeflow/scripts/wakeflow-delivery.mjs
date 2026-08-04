#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildWakeflowTrace } from "../lib/wakeflow-trace.mjs";
import { createDeliveryEvidence } from "./lib/wakeflow-delivery-evidence.mjs";
import { commandStatus as runStatusCommand } from "./lib/wakeflow-delivery-status-command.mjs";
import {
  createDeliveryStore,
  releaseWindowLockForResult,
} from "./lib/wakeflow-delivery-store.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import { createDispatchCommands } from "./lib/wakeflow-dispatch-commands.mjs";
import { createDispatchGroupReview } from "./lib/wakeflow-dispatch-group-review.mjs";
import { createKeepLiveManager } from "./lib/wakeflow-keep-live.mjs";
import { createResultRecordingCommands } from "./lib/wakeflow-result-recording-commands.mjs";
import { commandTraceSpine as runTraceSpineCommand } from "./lib/wakeflow-trace-spine-command.mjs";
import { createWindowRuntime } from "./lib/wakeflow-window-runtime.mjs";
import { createReviewCommands } from "./lib/wakeflow-review-commands.mjs";
import {
  controllerReturnReadinessIssue,
  normalizeReturnPolicyMode,
} from "./lib/wakeflow-return-policy.mjs";
import {
  buildReplaySummary,
  deliveryReadbackConfirmed,
  deliveryTransportAccepted,
  pruneWouldBreakReplay,
} from "./lib/wakeflow-idempotency.mjs";
import {
  WakeflowStateLockTimeoutError,
  withFileLock,
  withStateRootLock,
} from "./lib/wakeflow-state-lock.mjs";
import {
  loadWorkspaceConfig,
  workspaceLedgerPaths,
} from "./lib/wakeflow-config.mjs";

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const options = args[0] && !args[0].startsWith("--") ? args.slice(1) : args;
const workspaceRoot = inferWorkspaceRoot();
const stateDir = resolveStateDir();
const deliveryWorkspaceConfig = loadWorkspaceConfig({ workspaceRoot, args: [] });
const deliveryLedgerPaths = workspaceLedgerPaths({
  workspaceRoot,
  args: [],
  config: deliveryWorkspaceConfig,
});
const scriptPath = new URL(import.meta.url).pathname;
const write = hasFlag("--write");
const json = hasFlag("--json");
const version = 1;
const threadRegistrationVersion = 4;
const deliveryEnvelopeVersion = 3;
const windowConfigVersion = 2;
const deliveryRunVersion = 2;
const keepLiveVersion = 1;

const helpText = `
Wakeflow delivery-loop contract manager

Usage:
  node scripts/wakeflow-delivery.mjs status [--json] [--verbose]
  node scripts/wakeflow-delivery.mjs prune-runtime [--before <iso>] [--write] [--json]
  node scripts/wakeflow-delivery.mjs release-window-lock --window <name> [--expected-delivery-id <id>] [--write] [--json]
  node scripts/wakeflow-delivery.mjs register-thread --window <name> --thread-id <id> --entry-sync-status pending|ready|failed [--launch-correlation-id <id> --binding-id <id> --state-root <path>] --write [--json]
  node scripts/wakeflow-delivery.mjs build-window-config --window <name> [--require-thread] --write [--json]
  node scripts/wakeflow-delivery.mjs build-delivery --packet-file <path> [--delivery-id <id>] [--return-route controller|none] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs prepare-dispatch-from-state --state-root <path> --target-task-id <id> [--group-target-task-id <id>...] [--task-package-id <id>] [--human-context-ref <ref>] [--controller-window <name>] [--group <id>] [--return-policy group-ready|per-target] [--expected-preview-digest <sha256>] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs build-controller-return --group <id> --trigger-target <window> --trigger-task-id <taskId> [--state-root <path>] [--human-context-ref <ref>] [--controller-window <name>] [--return-reason result-ready|blocked] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs record-delivery-run --delivery-file <path> --status sent|blocked|failed --transport-status accepted|rejected-before-send|ambiguous --readback-status confirmed|pending|unavailable --readback-attempts <n> [--readback-ok true|false] [--host-method ${hostProfile.hostTools.sendToWindow}] [--host-mode new-turn|unknown] [--evidence <text>] [--error <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs start-keep-live --automation-run-id <id> [--keep-live-command <cmd>] [--keep-live-arg <arg>...] [--no-keep-live] --write [--json]
  node scripts/wakeflow-delivery.mjs stop-keep-live --automation-run-id <id> [--reason <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs keep-live-state --automation-run-id <id> --status running|stopped|failed [--mechanism macos-caffeinate|manual|none] [--pid <pid>] [--error <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs record-target-result --target-window <name> --task-id <id> --status completed|blocked|needs-review [--group <id>] [--summary <text>] [--changed-repo <repo>...] [--commit <hash>...] [--commit-disposition <committed|left-uncommitted|no-changes>] [--evidence-ref <ref>...] [--verification <text>...] [--risk <text>...] [--craft-evidence <json>] [--next-suggestion <text>] [--supersede-result] [--write] [--json]
  node scripts/wakeflow-delivery.mjs review-results (--group <id>|--task-id <id>) [--json]
  node scripts/wakeflow-delivery.mjs review-pack (--group <id>|--task-id <id>|--state-root <path>) [--json]
  node scripts/wakeflow-delivery.mjs task-ledger --state-root <path> [--task-id <id>] [--target-window <name>] [--json]
  node scripts/wakeflow-delivery.mjs trace-spine [--state-root <path>] [--group <id>] [--target-window <name>] [--task-id <id>] [--result-file <path>] [--result-id <id>] [--delivery-file <path>] [--delivery-id <id>] [--json]
  node scripts/wakeflow-delivery.mjs stop-loop --reason <text> [--automation-run-id <id>] --write [--json]

Design:
  This script is the ${hostProfile.closedLoopContractName} contract surface. Dispatches
  are state-root only. The script does not parse current plans, decide
  sendable windows, claim target work, create legacy automation jobs, or
  accept results. Total control creates dispatch packets and later inspects
  target review inputs and independently validates behavior. Delivery adapters only consume the delivery envelope. Target
  windows return result envelopes.
`.trim();

class CliExit extends Error {}

function resolveStateDir() {
  const canonicalStateDir = path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const requestedStateDir = path.resolve(getValue("--state-dir", canonicalStateDir));
  const legacyStateDir = path.resolve(workspaceRoot, ".workspace-local/wakeflow-delivery");
  if (sameResolvedPath(requestedStateDir, legacyStateDir)) {
    process.stderr.write(
      `wakeflow-delivery: redirected legacy state dir ${legacyStateDir} to ${canonicalStateDir}\n`,
    );
    return canonicalStateDir;
  }
  return requestedStateDir;
}

function sameResolvedPath(left, right) {
  return path.normalize(left) === path.normalize(right);
}

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

function getAllValues(name) {
  const values = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === name && options[index + 1] && !options[index + 1].startsWith("--")) {
      values.push(options[index + 1]);
      index += 1;
    } else if (option.startsWith(`${name}=`)) {
      values.push(option.slice(name.length + 1));
    }
  }
  return values;
}

function inferWorkspaceRoot() {
  const explicitRoot = getValue("--root", "");
  if (explicitRoot) return path.resolve(explicitRoot);
  const deliveryFile = getValue("--delivery-file", "");
  if (command === "record-delivery-run" && deliveryFile && path.isAbsolute(deliveryFile)) {
    const marker = `${path.sep}.wakeflow-local${path.sep}wakeflow-delivery${path.sep}delivery-envelopes${path.sep}`;
    const index = deliveryFile.indexOf(marker);
    if (index > 0) return path.resolve(deliveryFile.slice(0, index));
  }
  return path.resolve(process.cwd());
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
    source: "wakeflow-delivery",
    ...fields,
  });
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function output(payload, textLines = []) {
  const complete = { scriptComplete: true, ...payload };
  if (!complete.agentNext) {
    complete.agentNext = inferAgentNext(complete);
  }
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  for (const line of textLines) {
    console.log(line);
  }
  if (complete.agentNext) {
    console.log(`Agent next: ${complete.agentNext}`);
  }
}

function inferAgentNext(payload) {
  if (!payload.ok) return "Stop and inspect the reported closed-loop contract issue.";
  if (payload.command === "prepare-dispatch-from-state") return payload.threadReady ? "Send the prepared prompt with the host thread tool, then record a delivery run." : "Register the target thread before direct-thread delivery.";
  if (payload.command === "register-thread") return "Build or refresh the derived local window config, then build delivery envelopes when total control decides to dispatch.";
  if (payload.command === "build-window-config") return "Use this child-window config when creating direct-thread delivery envelopes.";
  if (payload.command === "build-delivery") return payload.threadReady ? "Send the prompt with the host thread tool, then record a delivery run." : "Register the target thread before direct-thread delivery.";
  if (payload.command === "build-controller-return") return payload.threadReady ? "Send the controller-return prompt with the host thread tool, then record a delivery run." : "Register the controller thread before unattended return.";
  if (payload.command === "record-delivery-run") {
    if (payload.status !== "sent") {
      return payload.transportStatus === "rejected-before-send"
        ? payload.windowLockReleased
          ? "The host rejected the send before it began and the exact matching delivery lease was released; total control may repair the host and deliberately retry the same envelope."
          : "The host rejected the send before it began, but no exact matching delivery lease was released. Inspect the current lease before any deliberate retry; do not infer ownership from delivery id alone."
        : "Transport outcome is ambiguous; preserve the lease and return to total-control judgment. Do not resend from readback uncertainty.";
    }
    if (payload.readbackStatus === "confirmed") {
      return "Controller-side delivery is complete; end this dispatch turn and wait for a controller-return or new user input. Do not poll, sleep, or run review-results just to wait.";
    }
    return "The host accepted this delivery, but the one bounded readback did not confirm destination visibility. Record it as sent-unconfirmed, do not resend or release its lease, and stop with the uncertainty visible for controller judgment.";
  }
  if (payload.command === "start-keep-live") return payload.keepLive?.active ? "Continue unattended direct-thread dispatch; keep-live is active." : "Treat keep-live as an automation readiness risk before claiming unattended reliability.";
  if (payload.command === "stop-keep-live") return payload.keepLive?.retainedByOtherRuns ? "Keep-live is retained by other active automation runs." : payload.keepLive?.active ? "Inspect and stop the recorded keep-live process before claiming shutdown is clean." : "Keep-live is stopped; continue only by total-control judgment.";
  if (payload.command === "keep-live-state") return "Continue or stop unattended automation according to the current plan and keep-live status.";
  if (payload.command === "record-target-result") return "Run review-results for the dispatch group; if controller return is allowed, build the controller-return envelope, send it with the host thread tool, then record that delivery run.";
  if (payload.command === "review-results") return payload.decision === "wait" ? "No controller review is available yet; stop this turn and wait for the target/controller-return instead of polling or sleeping." : "If this is a target window and controller return is allowed, build-controller-return, send it with the host thread tool, then record that delivery run; total control must still inspect the review inputs and independently validate behavior before acceptance.";
  if (payload.command === "review-pack") {
    if (payload.decision === "completed") return "Demand is completed; stop without creating new deliveries.";
    if (payload.decision === "no-target-tasks") return "No target tasks are reviewable; add a task package before dispatch or review.";
    if (payload.reviewPack?.nextAction === "dispatch-pending-target-before-result-review") return "No sent target result is missing; return to total-control judgment and dispatch the pending target before waiting for a result.";
    return payload.decision === "wait" ? "No controller review is available yet; stop this turn and wait for the target/controller-return instead of polling or sleeping." : "Use this review pack to inspect target review inputs, independently validate the relevant behavior, then make a total-control verdict.";
  }
  if (payload.command === "trace-spine") return "Use the trace spine to inspect evidence and runtime gaps; it is read-only and not a controller acceptance verdict.";
  if (payload.command === "stop-loop") return payload.keepLive?.retainedByOtherRuns ? "Closed-loop delivery is stopped for this run; keep-live remains active for other runs." : "Closed-loop delivery is stopped; do not create new deliveries.";
  return "Continue by total-control judgment.";
}

function classifyErrorCode(message = "") {
  const text = String(message);
  const rules = [
    [/controller event revision .*reserved|recover or replay delivery run/i, "delivery-state-recovery-required"],
    [/controller event log .*malformed|repair the event log/i, "delivery-event-log-repair-required"],
    [/state revision/i, "stale-state-revision"],
    [/outside workspace/i, "scope-boundary-violation"],
    [/No registered .*thread|thread.*missing|thread id/i, "thread-registration-invalid"],
    [/already .*controller-return|duplicate controller returns/i, "controller-return-duplicate"],
    [/missing results|missing target results|missing result/i, "target-result-missing"],
    [/pending-host-send|host send|readback/i, "host-readback-unconfirmed"],
    [/evidence/i, "evidence-insufficient"],
    [/return policy|Invalid return policy/i, "return-policy-invalid"],
    [/not part of dispatch group|No matching dispatch packets|requires --group|requires --state-root/i, "dispatch-context-missing"],
    [/Delivery file must contain|unreadable|JSON/i, "artifact-invalid"],
    [/completed|archived|cancelled|blocked/i, "state-not-dispatchable"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "wakeflow-contract-error";
}

function fail(message, options = {}) {
  const errorCode = options.errorCode || classifyErrorCode(message);
  output({
    ok: false,
    command,
    errorCode,
    error: message,
    diagnostics: {
      code: errorCode,
      severity: "error",
      plane: "delivery-loop",
      retryable: options.retryable
        ?? ["host-readback-unconfirmed", "thread-registration-invalid", "delivery-state-recovery-required", "delivery-event-log-repair-required"].includes(errorCode),
      ...(options.recovery ? { recovery: options.recovery } : {}),
    },
  });
  process.exitCode = 1;
  throw new CliExit(message);
}

const {
  dirs,
  ensureInsideWorkspace,
  ensureStateDirs,
  atomicWriteJson,
  readJson,
  readStateRootJson,
  atomicWriteStateRootJson,
  appendStateRootJsonLine,
  resolveInputPath,
  resolveStateRoot,
  readControllerStateRoot,
  readTaskPackageFromStateRoot,
  packetFileFor,
  findPacketFile,
  groupFileFor,
  findGroupFile,
  deliveryFileFor,
  findDeliveryFile,
  deliveryRunFileFor,
  findDeliveryRunFile,
  threadFileFor,
  findThreadFile,
  windowConfigFileFor,
  resultFileFor,
  findResultFile,
  supersededResultFileFor,
  listJsonFiles,
  lockFileFor,
  readWindowLock,
  windowLockFresh,
  writeWindowLock,
  removeWindowLock,
  removeRuntimeFile,
  listFreshWindowLocks,
  listHostRuntimes,
  dispatchPacketsForTask,
  listDispatchGroupsForTask,
} = createDeliveryStore({
  workspaceRoot,
  stateDir,
  sanctionedStateRoots: [
    deliveryLedgerPaths.workspaceCurrentDir,
    deliveryLedgerPaths.projectLedgerRoot,
  ],
  slug,
  nowIso,
  fail,
});

const {
  keepLiveStateFile,
  keepLiveControlFile,
  keepLiveStatus,
  startKeepLive,
  stopKeepLive,
  runKeepLiveWorker,
} = createKeepLiveManager({
  version: keepLiveVersion,
  workspaceRoot,
  stateDir,
  scriptPath,
  hasFlag,
  getValue,
  getAllValues,
  nowIso,
  fail,
  ensureStateDirs,
  atomicWriteJson,
});

function loadDispatchGroup(groupId, stateRef = null) {
  if (!groupId) return null;
  const file = findGroupFile(groupId, stateRef);
  if (!existsSync(file)) return null;
  const group = readJson(file, "dispatch group");
  if (group.kind !== "DispatchGroup" || group.groupId !== groupId) {
    fail(`Invalid dispatch group state for ${groupId}.`);
  }
  return group;
}

function targetDescriptor({ targetWindow, taskId, packetId }) {
  return {
    targetWindow,
    taskId,
    packetId,
  };
}

function sameTargetDescriptor(left, right) {
  return left.targetWindow === right.targetWindow && left.taskId === right.taskId;
}

function dispatchGroupStateRef(stateRef = {}) {
  if (!stateRef?.stateRoot) return null;
  return {
    stateRoot: stateRef.stateRoot,
    demandKey: stateRef.demandKey,
    stateRevision: stateRef.stateRevision,
  };
}

function sameDispatchGroupState(left = {}, right = {}) {
  if (!left?.stateRoot || !right?.stateRoot) return false;
  if (left.stateRoot !== right.stateRoot) return false;
  if (left.demandKey && right.demandKey && left.demandKey !== right.demandKey) return false;
  return true;
}

function upsertDispatchGroup({
  groupId,
  controllerWindow = "",
  humanContextRef = "",
  returnPolicyMode,
  stateRef = null,
  targetWindow,
  taskId,
  packetId,
  expectedTargets: requestedTargets = [],
  membershipExplicit = false,
}) {
  if (!groupId) return null;
  const existing = loadDispatchGroup(groupId, stateRef);
  const mode = existing?.returnPolicy?.mode || validateReturnPolicyMode(returnPolicyMode || "group-ready");
  if (returnPolicyMode && existing?.returnPolicy?.mode && existing.returnPolicy.mode !== returnPolicyMode) {
    fail(`Dispatch group ${groupId} already uses return policy ${existing.returnPolicy.mode}; cannot change to ${returnPolicyMode}.`);
  }
  if (!stateRef) fail("Dispatch groups require stateRef from a controller state root.");
  const groupStateRef = dispatchGroupStateRef(stateRef);
  if (!groupStateRef) fail("Dispatch groups require stateRef.stateRoot from a controller state root.");
  if (existing?.stateRef && !sameDispatchGroupState(dispatchGroupStateRef(existing.stateRef), groupStateRef)) {
    fail(`Dispatch group ${groupId} already belongs to a different state root.`);
  }
  const existingControllerWindow = existing?.controllerWindow || "";
  if (controllerWindow && existingControllerWindow && existingControllerWindow !== controllerWindow) {
    fail(`Dispatch group ${groupId} already returns to controller ${existingControllerWindow}; cannot change to ${controllerWindow}.`);
  }
  const groupControllerWindow = existingControllerWindow || controllerWindow || undefined;

  const existingTargets = [...(Array.isArray(existing?.expectedTargets) ? existing.expectedTargets : [])];
  const descriptor = targetDescriptor({ targetWindow, taskId, packetId });
  const expectedTargets = (requestedTargets.length > 0 ? requestedTargets : [descriptor])
    .map((item) => targetDescriptor(item))
    .sort((left, right) => `${left.targetWindow}\u0000${left.taskId}`.localeCompare(`${right.targetWindow}\u0000${right.taskId}`));
  const requestedKeys = expectedTargets.map((item) => `${item.targetWindow}\u0000${item.taskId}`);
  if (new Set(requestedKeys).size !== requestedKeys.length) {
    fail(`Dispatch group ${groupId} membership contains duplicate targets.`);
  }
  if (!expectedTargets.some((item) => sameTargetDescriptor(item, descriptor))) {
    fail(`Dispatch group ${groupId} membership does not include prepared target ${targetWindow} / ${taskId}.`);
  }
  if (existing?.membershipFinalized) {
    const existingKeys = existingTargets
      .map((item) => `${item.targetWindow}\u0000${item.taskId}`)
      .sort();
    if (JSON.stringify(existingKeys) !== JSON.stringify([...requestedKeys].sort())) {
      fail(`Dispatch group ${groupId} membership is finalized; prepare with the same complete groupTaskIds or use a new group.`);
    }
  } else if (existing && !membershipExplicit && !existingTargets.some((item) => sameTargetDescriptor(item, descriptor))) {
    fail(`Dispatch group ${groupId} has legacy/unfinalized membership; pass the complete groupTaskIds explicitly before preparing another target.`);
  }
  for (const item of expectedTargets) {
    const prior = existingTargets.find((candidate) => sameTargetDescriptor(candidate, item));
    if (prior?.packetId && !item.packetId) item.packetId = prior.packetId;
  }
  const updatedAt = nowIso();
  const createdAt = existing?.createdAt || updatedAt;

  return {
    kind: "DispatchGroup",
    version,
    groupId,
    humanContextRef: humanContextRef || existing?.humanContextRef || undefined,
    stateRef: existing?.stateRef ? dispatchGroupStateRef(existing.stateRef) : groupStateRef,
    controllerWindow: groupControllerWindow,
    expectedTargets,
    membershipFinalized: true,
    returnPolicy: {
      mode,
    },
    wakeflowTrace: artifactTrace({
      artifactKind: "dispatch-group",
      createdAt,
      dispatchGroup: groupId,
      stateRef: existing?.stateRef ? dispatchGroupStateRef(existing.stateRef) : groupStateRef,
      targetTaskId: taskId,
      targetWindow,
    }),
    createdAt,
    updatedAt,
  };
}

function validateControllerReturnAllowed({ review, triggerTarget, triggerTaskId }) {
  const issue = controllerReturnReadinessIssue({ review, triggerTarget, triggerTaskId });
  if (issue) fail(issue.message);
  return review.results.find((item) => item.packet.targetWindow === triggerTarget && item.packet.taskId === triggerTaskId);
}

function requireValue(name) {
  const value = getValue(name, "");
  if (!value.trim()) fail(`${name} is required.`);
  return value.trim();
}

function validateContextPolicy(value) {
  const allowed = new Set(["assumed-current", "refresh-if-missing", "force-refresh"]);
  if (!allowed.has(value)) {
    fail(`--context-policy must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateReturnRoute(value) {
  const allowed = new Set(["controller", "none"]);
  if (!allowed.has(value)) {
    fail(`--return-route must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateReturnReason(value) {
  const allowed = new Set(["result-ready", "blocked"]);
  if (!allowed.has(value)) {
    fail(`--return-reason must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateReturnPolicyMode(value) {
  try {
    return normalizeReturnPolicyMode(value);
  } catch {
    fail("--return-policy must be one of: group-ready, per-target");
  }
}

function validateKeepLiveStatus(value) {
  const allowed = new Set(["running", "stopped", "failed"]);
  if (!allowed.has(value)) {
    fail(`--status must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function commandKeepLiveWorker() {
  runKeepLiveWorker({
    automationRunId: requireValue("--automation-run-id"),
    token: requireValue("--token"),
  });
}

function readJsonArtifact(file) {
  try {
    return { file, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { file, error: error.message };
  }
}

function listJsonArtifacts(dir) {
  return listJsonFiles(dir).map((file) => readJsonArtifact(file));
}

function artifactValues(artifacts, kind = "") {
  return artifacts
    .filter((item) => !item.error && (!kind || item.value?.kind === kind))
    .map((item) => ({ file: item.file, value: item.value }));
}

function commandTraceSpine() {
  runTraceSpineCommand({
    workspaceRoot,
    dirs,
    getValue,
    output,
    fail,
    resolveInputPath,
    ensureInsideWorkspace,
    readJson,
    listJsonArtifacts,
    artifactValues,
    readJsonArtifact,
    computeReviewResults,
    redactDeliveryEnvelope,
  });
}

const {
  controllerReturnDeliveryStatusForGroup,
  targetDeliveryStatusesForPacket,
  deliveryExpectationForPacket,
} = createDeliveryEvidence({
  workspaceRoot,
  dirs,
  listJsonFiles,
  readJson,
});

const {
  groupFromPackets,
  orderResultsByGroup,
  buildGroupSnapshot,
} = createDispatchGroupReview({
  workspaceRoot,
  version,
  artifactTrace,
  fail,
  loadDispatchGroup,
  targetDescriptor,
  dispatchGroupStateRef,
  deliveryExpectationForPacket,
});

const {
  buildReviewPack,
  buildStateRootReviewPack,
  computeReviewResults,
  commandReviewResults,
  commandReviewPack,
  commandTaskLedger,
} = createReviewCommands({
  workspaceRoot,
  stateDir,
  dirs,
  version,
  getValue,
  output,
  fail,
  nowIso,
  artifactTrace,
  readControllerStateRoot,
  resolveStateRoot,
  listJsonFiles,
  readJson,
  resultFileFor,
  findResultFile,
  controllerReturnDeliveryStatusForGroup,
  targetDeliveryStatusesForPacket,
  groupFromPackets,
  orderResultsByGroup,
  buildGroupSnapshot,
});

const {
  readWorkspaceConfig,
  formatTargetPrompt,
  commandRegisterThread,
  loadThreadRegistration,
  redactDeliveryEnvelope,
  buildWindowConfig,
  commandBuildWindowConfig,
} = createWindowRuntime({
  workspaceRoot,
  stateDir,
  write,
  hasFlag,
  getValue,
  requireValue,
  nowIso,
  fail,
  output,
  ensureStateDirs,
  atomicWriteJson,
  readJson,
  threadFileFor,
  findThreadFile,
  windowConfigFileFor,
  threadRegistrationVersion,
  windowConfigVersion,
  withFileLock,
  WakeflowStateLockTimeoutError,
});

const {
  commandBuildDelivery,
  commandPrepareDispatchFromState,
  commandBuildControllerReturn,
} = createDispatchCommands({
  workspaceRoot,
  stateDir,
  write,
  hasFlag,
  getValue,
  getAllValues,
  requireValue,
  validateContextPolicy,
  validateReturnPolicyMode,
  validateReturnRoute,
  validateReturnReason,
  fail,
  output,
  slug,
  nowIso,
  version,
  deliveryEnvelopeVersion,
  readJson,
  ensureStateDirs,
  atomicWriteJson,
  resolveInputPath,
  resolveStateRoot,
  readControllerStateRoot,
  readTaskPackageFromStateRoot,
  packetFileFor,
  findPacketFile,
  groupFileFor,
  findGroupFile,
  deliveryFileFor,
  findDeliveryFile,
  threadFileFor,
  findThreadFile,
  windowConfigFileFor,
  readWindowLock,
  windowLockFresh,
  writeWindowLock,
  lockFileFor,
  releaseWindowLockForResult,
  keepLiveStateFile,
  startKeepLive,
  artifactTrace,
  upsertDispatchGroup,
  loadDispatchGroup,
  computeReviewResults,
  validateControllerReturnAllowed,
  controllerReturnDeliveryStatusForGroup,
  readWorkspaceConfig,
  loadThreadRegistration,
  buildWindowConfig,
  redactDeliveryEnvelope,
  formatTargetPrompt,
  withFileLock,
  WakeflowStateLockTimeoutError,
});

const {
  commandRecordDeliveryRun,
  commandRecordTargetResult,
} = createResultRecordingCommands({
  workspaceRoot,
  stateDir,
  write,
  hasFlag,
  getValue,
  getAllValues,
  requireValue,
  fail,
  output,
  slug,
  nowIso,
  version,
  deliveryRunVersion,
  readJson,
  readStateRootJson,
  atomicWriteStateRootJson,
  appendStateRootJsonLine,
  ensureStateDirs,
  atomicWriteJson,
  resolveInputPath,
  resolveStateRoot,
  deliveryFileFor,
  findDeliveryFile,
  findPacketFile,
  deliveryRunFileFor,
  findDeliveryRunFile,
  keepLiveStateFile,
  resultFileFor,
  findResultFile,
  supersededResultFileFor,
  lockFileFor,
  readWindowLock,
  windowLockFresh,
  writeWindowLock,
  removeWindowLock,
  dispatchPacketsForTask,
  listDispatchGroupsForTask,
  loadDispatchGroup,
  artifactTrace,
  withFileLock,
  withStateRootLock,
  WakeflowStateLockTimeoutError,
});

function commandReleaseWindowLock() {
  const windowName = requireValue("--window");
  const expectedDeliveryId = getValue("--expected-delivery-id", "");
  const lock = readWindowLock(windowName);
  if (!lock) {
    // readWindowLock returns null for BOTH missing and unparsable files; a
    // corrupt lock must still be removable by this recovery command.
    const file = lockFileFor(windowName);
    if (existsSync(file)) {
      if (write && expectedDeliveryId) {
        output({
          ok: true,
          command: "release-window-lock",
          windowName,
          expectedDeliveryId,
          released: false,
          note: "lock file is unreadable; an exact delivery-id release cannot prove ownership, so the lock was preserved",
        });
      } else if (write) {
        removeWindowLock(windowName);
        output({ ok: true, command: "release-window-lock", windowName, released: true, note: "corrupt lock file removed" });
      } else {
        output({ ok: true, command: "release-window-lock", windowName, released: false, dryRun: true, note: "lock file exists but is unreadable (corrupt); pass --write to remove it" });
      }
      return;
    }
    output({ ok: true, command: "release-window-lock", windowName, released: false, note: "no lock present" });
    return;
  }
  if (!write) {
    output({
      ok: true,
      command: "release-window-lock",
      windowName,
      released: false,
      dryRun: true,
      lock: { host: lock.host, deliveryId: lock.deliveryId, createdAt: lock.createdAt, expiresAt: lock.expiresAt, fresh: windowLockFresh(lock) },
      expectedDeliveryId: expectedDeliveryId || undefined,
      expectedDeliveryMatches: expectedDeliveryId ? lock.deliveryId === expectedDeliveryId : undefined,
      note: expectedDeliveryId
        ? "pass --write to compare-and-release only this delivery id"
        : "pass --write to release; releasing another host's fresh lock should be a deliberate recovery decision",
    });
    return;
  }
  const lockFile = lockFileFor(windowName);
  const released = releaseWindowLockForResult(
    lockFile,
    (current) => expectedDeliveryId
      ? current.deliveryId === expectedDeliveryId
      : current.leaseId === lock.leaseId && current.deliveryId === lock.deliveryId,
  );
  const current = released ? null : readWindowLock(windowName);
  output({
    ok: true,
    command: "release-window-lock",
    windowName,
    expectedDeliveryId: expectedDeliveryId || undefined,
    released,
    ...(released
      ? { releasedLock: { host: lock.host, deliveryId: lock.deliveryId, expiresAt: lock.expiresAt } }
      : {
          currentLock: current
            ? { host: current.host, deliveryId: current.deliveryId, expiresAt: current.expiresAt }
            : undefined,
          note: current
            ? "current lock does not match expectedDeliveryId; it was preserved"
            : "lock disappeared before release; no different lease was removed",
        }),
  });
}

function commandStatus() {
  runStatusCommand({
    workspaceRoot,
    stateDir,
    dirs,
    listHostRuntimes,
    listFreshWindowLocks,
    helpText,
    hasFlag,
    output,
    listJsonFiles,
    listJsonArtifacts,
    artifactValues,
    readJsonArtifact,
    keepLiveStatus,
    keepLiveStateFile,
    artifactTrace,
    nowIso,
  });
}


function commandStartKeepLive() {
  if (!write) fail("start-keep-live requires --write.");
  const automationRunId = requireValue("--automation-run-id");
  const keepLive = startKeepLive({ automationRunId });
  output(
    {
      ok: keepLive.status !== "failed",
      command: "start-keep-live",
      wrote: true,
      ready: Boolean(keepLive.active),
      keepLive,
      stateFile: path.relative(workspaceRoot, keepLiveStateFile()),
      controlFile: path.relative(workspaceRoot, keepLiveControlFile()),
    },
    [
      `Keep-live ${keepLive.message || keepLive.status} for ${automationRunId}.`,
      `Active: ${keepLive.active ? "yes" : "no"}`,
    ],
  );
}

function commandStopKeepLive() {
  if (!write) fail("stop-keep-live requires --write.");
  const automationRunId = requireValue("--automation-run-id");
  const reason = getValue("--reason", "manual stop");
  const keepLive = stopKeepLive({ automationRunId, reason });
  output(
    {
      ok: keepLive.status !== "failed",
      command: "stop-keep-live",
      wrote: true,
      keepLive,
      stateFile: path.relative(workspaceRoot, keepLiveStateFile()),
      controlFile: path.relative(workspaceRoot, keepLiveControlFile()),
    },
    [
      `Keep-live ${keepLive.message || keepLive.status} for ${automationRunId}.`,
      `Active: ${keepLive.active ? "yes" : "no"}`,
    ],
  );
}

function commandKeepLiveState() {
  if (!write) fail("keep-live-state requires --write.");
  const automationRunId = requireValue("--automation-run-id");
  const status = validateKeepLiveStatus(requireValue("--status"));
  const pidValue = getValue("--pid", "");
  const pid = pidValue ? Number(pidValue) : undefined;
  if (pidValue && (!Number.isInteger(pid) || pid <= 0)) fail("--pid must be a positive integer.");
  const state = {
    kind: "AutomationKeepLiveState",
    version: keepLiveVersion,
    enabled: status === "running",
    automationRunId,
    mechanism: getValue("--mechanism", "manual"),
    startedAt: status === "running" ? nowIso() : undefined,
    stoppedAt: status === "stopped" ? nowIso() : undefined,
    pid,
    status,
    lastCheckedAt: nowIso(),
    error: getValue("--error", "") || null,
  };
  if (status === "failed" && !state.error) fail("failed keep-live state requires --error.");
  ensureStateDirs();
  atomicWriteJson(keepLiveStateFile(), state);
  output(
    {
      ok: true,
      command: "keep-live-state",
      wrote: true,
      status,
      state,
      stateFile: path.relative(workspaceRoot, keepLiveStateFile()),
    },
    [
      `Recorded keep-live state for ${automationRunId}.`,
      `Status: ${status}`,
    ],
  );
}

function commandStopLoop() {
  if (!write) fail("stop-loop requires --write.");
  const reason = requireValue("--reason");
  const keepLive = stopKeepLive({ automationRunId: getValue("--automation-run-id", ""), reason });
  const marker = {
    kind: hostProfile.kinds.automationLoopStop,
    version,
    stoppedAt: nowIso(),
    reason,
    keepLive: {
      active: keepLive.active,
      status: keepLive.status,
      stateFile: path.relative(stateDir, keepLiveStateFile()),
    },
  };
  atomicWriteJson(path.join(stateDir, "stop.json"), marker);
  output(
    {
      ok: keepLive.status !== "failed",
      command: "stop-loop",
      wrote: true,
      markerFile: path.relative(workspaceRoot, path.join(stateDir, "stop.json")),
      reason,
      keepLive,
    },
    [
      `Closed-loop delivery stopped: ${reason}`,
      `Keep-live: ${keepLive.active ? "still active" : keepLive.status}`,
    ],
  );
}

// prune-runtime: GC replay-safe, confirmed-send delivery-run files older than a cutoff.
// Target-results are durable result history and are NEVER deleted; a run inside a surviving repeated-attempt
// chain is retained so idempotency dup-detection keeps working. Dry-run unless --write, and
// --write requires --before to bound the deletion.
function commandPruneRuntime() {
  const before = getValue("--before", null);
  const beforeMs = before ? Date.parse(before) : null;
  if (before && Number.isNaN(beforeMs)) fail("--before must be an ISO timestamp.");
  if (write && before === null) fail("prune-runtime --write requires --before <iso> to bound the deletion.");

  const safeRead = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };

  const runEntries = listJsonFiles(dirs.deliveryRuns)
    .map((file) => ({ file, run: safeRead(file) }))
    .filter((entry) => entry.run?.kind === "DirectThreadDeliveryRun");
  const targetResults = listJsonFiles(dirs.results).map((file) => safeRead(file)).filter(Boolean);
  const replay = buildReplaySummary({ deliveryRuns: runEntries.map((entry) => entry.run), targetResults });

  const prunable = [];
  const retained = [];
  for (const { file, run } of runEntries) {
    const reasons = [];
    // Transport-accepted but readback-pending evidence is intentionally kept:
    // the observation may still be needed to explain why no resend occurred.
    if (!(deliveryTransportAccepted(run) && deliveryReadbackConfirmed(run))) reasons.push("not-a-confirmed-send-observation");
    if (pruneWouldBreakReplay(run.deliveryId, replay)) reasons.push("in-replay-chain");
    // A surviving envelope derives its host-send status from this run. Removing
    // the last accepted run while keeping the envelope would make status say
    // pending-host-send and could invite a duplicate delivery.
    const runStateRef = run.wakeflowTrace?.stateRoot || run.wakeflowTrace?.demandKey
      ? {
          stateRoot: run.wakeflowTrace?.stateRoot,
          demandKey: run.wakeflowTrace?.demandKey,
        }
      : null;
    if (existsSync(findDeliveryFile(run.deliveryId, runStateRef))) {
      reasons.push("delivery-envelope-still-present");
    }
    if (beforeMs !== null) {
      const runMs = run.createdAt ? Date.parse(run.createdAt) : NaN;
      if (Number.isNaN(runMs) || runMs >= beforeMs) reasons.push("not-before-cutoff");
    }
    const summary = { file: path.relative(workspaceRoot, file), deliveryRunId: run.deliveryRunId, deliveryId: run.deliveryId };
    if (reasons.length === 0) prunable.push({ ...summary, absFile: file });
    else retained.push({ ...summary, reasons });
  }

  let removed = 0;
  if (write) {
    for (const entry of prunable) {
      if (removeRuntimeFile(entry.absFile)) removed += 1;
    }
  }

  output({
    ok: true,
    command: "prune-runtime",
    wrote: write,
    before: before ?? null,
    deliveryRunCount: runEntries.length,
    prunableCount: prunable.length,
    prunable: prunable.map(({ absFile, ...rest }) => rest),
    removed,
    retainedCount: retained.length,
    retained,
    forbiddenConclusions: [
      "prune-is-acceptance",
      "prune-is-archive",
      "pruned-run-is-undelivered-work",
    ],
    agentNext: write
      ? "Pruned replay-safe confirmed-send delivery-runs older than the cutoff. Target-results are durable result history and are never pruned."
      : "Dry-run only. Review the prunable list, then rerun with --write --before <iso> to delete.",
  }, [
    `${write ? "Pruned" : "Would prune"} ${prunable.length} replay-safe delivery-run file(s)${write ? ` (${removed} removed)` : ""}.`,
    "Target-results are durable result history and are never deleted by prune-runtime.",
  ]);
}

try {
  switch (command) {
    case "status":
      commandStatus();
      break;
    case "release-window-lock":
      commandReleaseWindowLock();
      break;
    case "register-thread":
      commandRegisterThread();
      break;
    case "build-window-config":
      commandBuildWindowConfig();
      break;
    case "build-delivery":
      commandBuildDelivery();
      break;
    case "prepare-dispatch-from-state":
      commandPrepareDispatchFromState();
      break;
    case "build-controller-return":
      commandBuildControllerReturn();
      break;
    case "record-delivery-run":
      commandRecordDeliveryRun();
      break;
    case "start-keep-live":
      commandStartKeepLive();
      break;
    case "stop-keep-live":
      commandStopKeepLive();
      break;
    case "keep-live-worker":
      commandKeepLiveWorker();
      break;
    case "keep-live-state":
      commandKeepLiveState();
      break;
    case "record-target-result":
      commandRecordTargetResult();
      break;
    case "review-results":
      commandReviewResults();
      break;
    case "review-pack":
      commandReviewPack();
      break;
    case "task-ledger":
      commandTaskLedger();
      break;
    case "trace-spine":
      commandTraceSpine();
      break;
    case "stop-loop":
      commandStopLoop();
      break;
    case "prune-runtime":
      commandPruneRuntime();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(helpText);
      break;
    default:
      fail(`Unknown command: ${command}\n\n${helpText}`);
  }
} catch (error) {
  if (!(error instanceof CliExit)) {
    throw error;
  }
}
