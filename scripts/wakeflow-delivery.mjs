#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const options = args[0] && !args[0].startsWith("--") ? args.slice(1) : args;
const workspaceRoot = inferWorkspaceRoot();
const stateDir = path.resolve(getValue("--state-dir", path.join(workspaceRoot, ".workspace-local/wakeflow-delivery")));
const scriptPath = new URL(import.meta.url).pathname;
const write = hasFlag("--write");
const json = hasFlag("--json");
const version = 1;
const threadRegistrationVersion = 2;
const deliveryEnvelopeVersion = 2;
const windowConfigVersion = 1;
const deliveryRunVersion = 1;
const keepLiveVersion = 1;

const dirs = {
  packets: path.join(stateDir, "dispatch-packets"),
  groups: path.join(stateDir, "dispatch-groups"),
  deliveries: path.join(stateDir, "delivery-envelopes"),
  deliveryRuns: path.join(stateDir, "delivery-runs"),
  results: path.join(stateDir, "target-results"),
  registry: path.join(stateDir, "thread-registry"),
  windowConfig: path.join(stateDir, "window-config"),
  keepLive: path.join(stateDir, "keep-live"),
};

const helpText = `
Wakeflow delivery-loop contract manager

Usage:
  node scripts/wakeflow-delivery.mjs status [--json]
  node scripts/wakeflow-delivery.mjs register-thread --window <name> --thread-id <id> --write [--json]
  node scripts/wakeflow-delivery.mjs build-window-config --window <name> [--require-thread] --write [--json]
  node scripts/wakeflow-delivery.mjs build-delivery --packet-file <path> [--delivery-id <id>] [--return-route controller|none] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs prepare-dispatch-from-state --state-root <path> --target-task-id <id> [--task-package-id <id>] [--human-context-ref <ref>] [--controller-window <name>] [--group <id>] [--return-policy group-ready|per-target] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs build-controller-return --group <id> --trigger-target <window> --trigger-task-id <taskId> [--human-context-ref <ref>] [--controller-window <name>] [--return-reason result-ready|blocked] [--automation-enabled] [--require-thread] [--write] [--json]
  node scripts/wakeflow-delivery.mjs record-delivery-run --delivery-file <path> --status sent|blocked|failed [--host-method send_message_to_thread] [--host-mode new-turn|unknown] [--readback-ok true|false] [--evidence <text>] [--error <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs start-keep-live --automation-run-id <id> [--keep-live-command <cmd>] [--keep-live-arg <arg>...] [--no-keep-live] --write [--json]
  node scripts/wakeflow-delivery.mjs stop-keep-live --automation-run-id <id> [--reason <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs keep-live-state --automation-run-id <id> --status running|stopped|failed [--mechanism macos-caffeinate|manual|none] [--pid <pid>] [--error <text>] --write [--json]
  node scripts/wakeflow-delivery.mjs submit-result --target-window <name> --task-id <id> --status completed|blocked|needs-review [--group <id>] [--changed-repo <repo>...] [--commit <hash>...] [--evidence-ref <ref>...] [--verification <text>...] [--risk <text>...] [--next-suggestion <text>] [--write] [--json]
  node scripts/wakeflow-delivery.mjs review-results (--group <id>|--task-id <id>) [--json]
  node scripts/wakeflow-delivery.mjs review-pack (--group <id>|--task-id <id>|--state-root <path>) [--json]
  node scripts/wakeflow-delivery.mjs stop-loop --reason <text> [--automation-run-id <id>] --write [--json]

Design:
  This script is the CodexAutomationClosedLoop contract surface. Dispatches
  are state-root only. The script does not parse current plans, decide
  sendable windows, claim target work, create legacy automation jobs, or
  accept evidence. Total control creates dispatch packets and later reviews
  raw evidence. Delivery adapters only consume the delivery envelope. Target
  windows return result envelopes.
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
    const marker = `${path.sep}.workspace-local${path.sep}wakeflow-delivery${path.sep}delivery-envelopes${path.sep}`;
    const index = deliveryFile.indexOf(marker);
    if (index > 0) return path.resolve(deliveryFile.slice(0, index));
  }
  return path.resolve(process.cwd());
}

function nowIso() {
  return new Date().toISOString();
}

function eventIdFor(createdAt, revision) {
  return `evt-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(revision).padStart(4, "0")}`;
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
  if (payload.command === "record-delivery-run") return payload.status === "sent" ? "Controller-side delivery is complete; end this dispatch turn and wait for a controller-return or new user input. Do not poll, sleep, or run review-results just to wait." : "Return to total control judgment for the delivery block.";
  if (payload.command === "start-keep-live") return payload.keepLive?.active ? "Continue unattended direct-thread dispatch; keep-live is active." : "Treat keep-live as an automation readiness risk before claiming unattended reliability.";
  if (payload.command === "stop-keep-live") return payload.keepLive?.retainedByOtherRuns ? "Keep-live is retained by other active automation runs." : payload.keepLive?.active ? "Inspect and stop the recorded keep-live process before claiming shutdown is clean." : "Keep-live is stopped; continue only by total-control judgment.";
  if (payload.command === "keep-live-state") return "Continue or stop unattended automation according to the current plan and keep-live status.";
  if (payload.command === "submit-result") return "Run review-results for the dispatch group; if controller return is allowed, build the controller-return envelope, send it with the host thread tool, then record that delivery run.";
  if (payload.command === "review-results") return payload.decision === "wait" ? "No controller review is available yet; stop this turn and wait for the target/controller-return instead of polling or sleeping." : "If this is a target window and controller return is allowed, build-controller-return, send it with the host thread tool, then record that delivery run; total control must still review raw evidence before acceptance.";
  if (payload.command === "review-pack") {
    if (payload.decision === "completed") return "Demand is completed; stop without creating new deliveries.";
    if (payload.decision === "no-target-tasks") return "No target tasks are reviewable; add a task package before dispatch or review.";
    return payload.decision === "wait" ? "No controller review is available yet; stop this turn and wait for the target/controller-return instead of polling or sleeping." : "Use this review pack to pull raw evidence, then make a total-control verdict.";
  }
  if (payload.command === "stop-loop") return payload.keepLive?.retainedByOtherRuns ? "Closed-loop delivery is stopped for this run; keep-live remains active for other runs." : "Closed-loop delivery is stopped; do not create new deliveries.";
  return "Continue by total-control judgment.";
}

function fail(message) {
  output({ ok: false, command, error: message });
  process.exitCode = 1;
  throw new CliExit(message);
}

function ensureInsideWorkspace(file, label) {
  const relative = path.relative(workspaceRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} must stay inside workspace: ${file}`);
  }
}

function ensureStateDirs() {
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
}

function atomicWriteJson(file, value) {
  ensureInsideWorkspace(file, "closed-loop state");
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function appendJsonLine(file, value) {
  ensureInsideWorkspace(file, "controller event log");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}

function readJson(file, label = "JSON file") {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${file}: ${error.message}`);
  }
}

function resolveInputPath(value, label) {
  if (!value) fail(`${label} is required.`);
  const file = path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
  if (!existsSync(file)) fail(`${label} does not exist: ${value}`);
  return file;
}

function resolveStateRoot(value) {
  const stateRoot = resolveInputPath(value, "--state-root");
  ensureInsideWorkspace(stateRoot, "state root");
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  if (!existsSync(stateFile)) fail(`--state-root is missing wakeflow-state.json: ${value}`);
  return stateRoot;
}

function readControllerStateRoot(stateRoot) {
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"), "controller state");
  return {
    state,
    stateRootRef: path.relative(workspaceRoot, stateRoot),
  };
}

function readTaskPackageFromStateRoot(stateRoot, taskPackageId) {
  const file = path.join(stateRoot, "task-packages", `${slug(taskPackageId)}.json`);
  if (!existsSync(file)) fail(`task package does not exist in state root: ${taskPackageId}`);
  return readJson(file, "task package");
}

function packetFileFor(packetId) {
  return path.join(dirs.packets, `${slug(packetId)}.json`);
}

function groupFileFor(groupId) {
  return path.join(dirs.groups, `${slug(groupId)}.json`);
}

function deliveryFileFor(deliveryId) {
  return path.join(dirs.deliveries, `${slug(deliveryId)}.json`);
}

function deliveryRunFileFor(deliveryRunId) {
  return path.join(dirs.deliveryRuns, `${slug(deliveryRunId)}.json`);
}

function threadFileFor(windowName) {
  return path.join(dirs.registry, `${slug(windowName)}.json`);
}

function windowConfigFileFor(windowName) {
  return path.join(dirs.windowConfig, `${slug(windowName)}.json`);
}

function keepLiveStateFile() {
  return path.join(dirs.keepLive, "state.json");
}

function keepLiveControlFile() {
  return path.join(dirs.keepLive, "control.json");
}

function resultFileFor(targetWindow, taskId, dispatchGroup = "") {
  const parts = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug);
  return path.join(dirs.results, `${parts.join("__")}.json`);
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dir, name));
}

function loadDispatchGroup(groupId) {
  if (!groupId) return null;
  const file = groupFileFor(groupId);
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

function targetKey({ targetWindow, taskId }) {
  return `${targetWindow}\u0000${taskId}`;
}

function orderResultsByGroup({ groupRecord, results }) {
  const expectedTargets = Array.isArray(groupRecord?.expectedTargets) ? groupRecord.expectedTargets : [];
  const order = new Map(expectedTargets.map((target, index) => [targetKey(target), index]));
  return [...results].sort((left, right) => {
    const leftOrder = order.get(targetKey(left.packet)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(targetKey(right.packet)) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.packet.id).localeCompare(String(right.packet.id));
  });
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
}) {
  if (!groupId) return null;
  const existing = loadDispatchGroup(groupId);
  const mode = existing?.returnPolicy?.mode || validateReturnPolicyMode(returnPolicyMode || "group-ready");
  if (returnPolicyMode && existing?.returnPolicy?.mode && existing.returnPolicy.mode !== returnPolicyMode) {
    fail(`Dispatch group ${groupId} already uses return policy ${existing.returnPolicy.mode}; cannot change to ${returnPolicyMode}.`);
  }
  if (!stateRef) fail("Dispatch groups require stateRef from a controller state root.");
  if (existing?.stateRef && stateRef && JSON.stringify(existing.stateRef) !== JSON.stringify(stateRef)) {
    fail(`Dispatch group ${groupId} already belongs to a different state root.`);
  }
  const existingControllerWindow = existing?.controllerWindow || "";
  if (controllerWindow && existingControllerWindow && existingControllerWindow !== controllerWindow) {
    fail(`Dispatch group ${groupId} already returns to controller ${existingControllerWindow}; cannot change to ${controllerWindow}.`);
  }
  const groupControllerWindow = existingControllerWindow || controllerWindow || undefined;

  const expectedTargets = [...(Array.isArray(existing?.expectedTargets) ? existing.expectedTargets : [])];
  const descriptor = targetDescriptor({ targetWindow, taskId, packetId });
  const index = expectedTargets.findIndex((item) => sameTargetDescriptor(item, descriptor));
  if (index >= 0) {
    expectedTargets[index] = { ...expectedTargets[index], packetId };
  } else {
    expectedTargets.push(descriptor);
  }

  return {
    kind: "DispatchGroup",
    version,
    groupId,
    humanContextRef: humanContextRef || existing?.humanContextRef || undefined,
    stateRef: stateRef || existing?.stateRef || undefined,
    controllerWindow: groupControllerWindow,
    expectedTargets,
    returnPolicy: {
      mode,
    },
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function groupFromPackets({ groupId = "", packets = [] }) {
  if (!groupId) return null;
  const existing = loadDispatchGroup(groupId);
  if (existing) return existing;
  const firstPacket = packets[0] || {};
  if (!firstPacket.stateRef) {
    fail(`Dispatch group ${groupId} is missing stateRef; legacy Markdown-plan groups are no longer supported.`);
  }
  return {
    kind: "DispatchGroup",
    version,
    groupId,
    humanContextRef: firstPacket.humanContextRef,
    stateRef: firstPacket.stateRef,
    controllerWindow: firstPacket.controllerWindow,
    expectedTargets: packets.map((packet) => targetDescriptor({
      targetWindow: packet.targetWindow,
      taskId: packet.taskId,
      packetId: packet.id,
    })),
    returnPolicy: firstPacket.returnPolicy || { mode: "group-ready" },
    reconstructedFromPackets: true,
    createdAt: firstPacket.createdAt,
    updatedAt: firstPacket.createdAt,
  };
}

function resultSummary(item) {
  return {
    packetId: item.packet.id,
    targetWindow: item.packet.targetWindow,
    taskId: item.packet.taskId,
    status: item.result?.status || "missing",
    resultFile: item.result ? path.relative(workspaceRoot, item.file) : undefined,
  };
}

function uniqueTargetNames(items) {
  return [...new Set(items.map((item) => item.packet.targetWindow))];
}

function formatPromptTargetList(targets) {
  const uniqueTargets = [...new Set((targets || []).filter(Boolean))];
  return uniqueTargets.length > 0 ? uniqueTargets.join(", ") : "None";
}

function buildGroupSnapshot({ groupRecord, results }) {
  const expectedResults = results.map(resultSummary);
  const ready = results.filter((item) => item.result && item.result.status !== "blocked");
  const blocked = results.filter((item) => item.result?.status === "blocked");
  const missing = results.filter((item) => !item.result);
  const completed = ready.filter((item) => item.result?.status === "completed");
  const needsReview = ready.filter((item) => item.result?.status === "needs-review");
  const allResultsPresent = missing.length === 0;
  const groupStatus = allResultsPresent
    ? blocked.length > 0
      ? "blocked"
      : "ready"
    : ready.length > 0 || blocked.length > 0
      ? "partially-ready"
      : "waiting";

  return {
    groupId: groupRecord?.groupId,
    controllerWindow: groupRecord?.controllerWindow,
    returnPolicy: groupRecord?.returnPolicy || { mode: "group-ready" },
    groupStatus,
    expected: expectedResults,
    completed: completed.map(resultSummary),
    ready: ready.map(resultSummary),
    blocked: blocked.map(resultSummary),
    missing: missing.map(resultSummary),
    needsReview: needsReview.map(resultSummary),
    expectedTargets: uniqueTargetNames(results),
    completedTargets: uniqueTargetNames(completed),
    readyTargets: uniqueTargetNames(ready),
    blockedTargets: uniqueTargetNames(blocked),
    missingTargets: uniqueTargetNames(missing),
    allResultsPresent,
    reconstructedFromPackets: Boolean(groupRecord?.reconstructedFromPackets),
  };
}

function validateControllerReturnAllowed({ review, triggerTarget, triggerTaskId }) {
  const trigger = review.results.find((item) => item.packet.targetWindow === triggerTarget && item.packet.taskId === triggerTaskId);
  if (!trigger) {
    fail(`Trigger target ${triggerTarget} / ${triggerTaskId} is not part of dispatch group ${review.group}.`);
  }
  if (!trigger.result) {
    fail(`Cannot build controller return before trigger target result exists: ${triggerTarget} / ${triggerTaskId}.`);
  }
  const mode = review.returnPolicy.mode;
  if (mode === "group-ready" && !review.groupSnapshot.allResultsPresent) {
    fail(`Cannot build group-ready controller return while dispatch group has missing results: ${review.groupSnapshot.missing.map((item) => item.packetId).join(", ")}`);
  }
  return trigger;
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

function validateResultStatus(value) {
  const allowed = new Set(["completed", "blocked", "needs-review"]);
  if (!allowed.has(value)) {
    fail(`--status must be one of: ${[...allowed].join(", ")}`);
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
  const allowed = new Set(["group-ready", "per-target"]);
  if (!allowed.has(value)) {
    fail(`--return-policy must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateDeliveryRunStatus(value) {
  const allowed = new Set(["sent", "blocked", "failed"]);
  if (!allowed.has(value)) {
    fail(`--status must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateHostMode(value) {
  const allowed = new Set(["new-turn", "unknown"]);
  if (!allowed.has(value)) {
    fail(`--host-mode must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function validateKeepLiveStatus(value) {
  const allowed = new Set(["running", "stopped", "failed"]);
  if (!allowed.has(value)) {
    fail(`--status must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function parseBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  fail(`Boolean value expected, got: ${value}`);
}

function keepLiveCommand() {
  return getValue(
    "--keep-live-command",
    process.env.CODEX_AUTOMATION_KEEP_LIVE_COMMAND || "caffeinate",
  );
}

function keepLiveArgs() {
  const explicitArgs = getAllValues("--keep-live-arg");
  if (explicitArgs.length > 0) return explicitArgs;
  const jsonArgs = process.env.CODEX_AUTOMATION_KEEP_LIVE_ARGS_JSON;
  if (jsonArgs) {
    try {
      const parsed = JSON.parse(jsonArgs);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
    } catch {
      return ["-dims"];
    }
  }
  return ["-dims"];
}

function keepLiveEnabled() {
  if (hasFlag("--no-keep-live")) return false;
  if (process.env.CODEX_AUTOMATION_KEEP_LIVE === "0") return false;
  return true;
}

function keepLiveMechanism(commandName = keepLiveCommand()) {
  return process.platform === "darwin" && path.basename(commandName) === "caffeinate" ? "macos-caffeinate" : "process-watch";
}

function readOptionalJson(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function isPidRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function sleepSync(ms) {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitBuffer, 0, 0, ms);
}

function waitForPidExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true;
    sleepSync(50);
  }
  return !isPidRunning(pid);
}

function normalizeKeepLiveState(state = {}) {
  const commandName = state.command || keepLiveCommand();
  const args = Array.isArray(state.args) && state.args.every((item) => typeof item === "string") ? state.args : keepLiveArgs();
  const workerPid = Number.isInteger(Number(state.workerPid)) ? Number(state.workerPid) : Number(state.pid) || 0;
  const childPid = Number.isInteger(Number(state.childPid)) ? Number(state.childPid) : 0;
  const leases = normalizeKeepLiveLeases(state.leases, state.automationRunId, state);
  return {
    kind: "AutomationKeepLiveState",
    version: keepLiveVersion,
    enabled: keepLiveEnabled(),
    automationRunId: state.automationRunId || "",
    leases,
    activeAutomationRunIds: Object.keys(leases).sort(),
    activeRunCount: Object.keys(leases).length,
    mechanism: state.mechanism || keepLiveMechanism(commandName),
    strategy: state.strategy || "watcher",
    platform: process.platform,
    command: commandName,
    args,
    token: typeof state.token === "string" ? state.token : "",
    pid: workerPid,
    workerPid,
    childPid,
    status: state.status || "missing",
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    stopReason: state.stopReason || "",
    lastCheckedAt: nowIso(),
    error: state.error || null,
  };
}

function normalizeKeepLiveLeases(rawLeases, legacyAutomationRunId = "", state = {}) {
  const leases = {};
  if (rawLeases && typeof rawLeases === "object" && !Array.isArray(rawLeases)) {
    for (const [rawId, rawLease] of Object.entries(rawLeases)) {
      const automationRunId = String(rawId || "").trim();
      if (!automationRunId) continue;
      const lease = rawLease && typeof rawLease === "object" ? rawLease : {};
      leases[automationRunId] = {
        automationRunId,
        startedAt: typeof lease.startedAt === "string" ? lease.startedAt : nowIso(),
        lastSeenAt: typeof lease.lastSeenAt === "string" ? lease.lastSeenAt : nowIso(),
      };
    }
  }
  const legacyId = String(legacyAutomationRunId || "").trim();
  const legacyStateIsRunning = state.status === "running" || state.active === true;
  if (legacyId && legacyStateIsRunning && Object.keys(leases).length === 0) {
    leases[legacyId] = {
      automationRunId: legacyId,
      startedAt: nowIso(),
      lastSeenAt: nowIso(),
    };
  }
  return leases;
}

function keepLiveLeaseIds(leases = {}) {
  return Object.keys(leases).sort();
}

function touchKeepLiveLease(leases, automationRunId) {
  const id = String(automationRunId || "").trim();
  if (!id) fail("--automation-run-id is required for keep-live lease ownership.");
  const now = nowIso();
  return {
    ...leases,
    [id]: {
      automationRunId: id,
      startedAt: leases[id]?.startedAt || now,
      lastSeenAt: now,
    },
  };
}

function releaseKeepLiveLease(leases, automationRunId) {
  const ids = keepLiveLeaseIds(leases);
  if (ids.length === 0) return { leases, releasedAutomationRunId: "", remainingIds: [] };
  const id = String(automationRunId || "").trim();
  const releaseId = id || (ids.length === 1 ? ids[0] : "");
  if (!releaseId || !leases[releaseId]) {
    return { leases, releasedAutomationRunId: "", remainingIds: ids };
  }
  const nextLeases = { ...leases };
  delete nextLeases[releaseId];
  return {
    leases: nextLeases,
    releasedAutomationRunId: releaseId,
    remainingIds: keepLiveLeaseIds(nextLeases),
  };
}

function keepLiveStatus(extra = {}) {
  const state = normalizeKeepLiveState(readOptionalJson(keepLiveStateFile()));
  const workerActive = isPidRunning(state.workerPid);
  const childActive = isPidRunning(state.childPid);
  const active = workerActive || childActive;
  const status = active ? "running" : state.status === "failed" ? "failed" : state.status === "stopped" ? "stopped" : "missing";
  return {
    ...state,
    ...extra,
    active,
    workerActive,
    childActive,
    status: extra.status || status,
    lastCheckedAt: nowIso(),
  };
}

function writeKeepLiveControl(value) {
  atomicWriteJson(keepLiveControlFile(), value);
}

function readKeepLiveControl() {
  return readOptionalJson(keepLiveControlFile());
}

function keepLiveWorkerArgs(status, token, automationRunId) {
  return [
    scriptPath,
    "keep-live-worker",
    "--root",
    workspaceRoot,
    "--state-dir",
    stateDir,
    "--automation-run-id",
    automationRunId,
    "--token",
    token,
    "--keep-live-command",
    status.command,
    ...status.args.flatMap((arg) => ["--keep-live-arg", arg]),
  ];
}

function readWorkerControl(token, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const control = readKeepLiveControl();
    if (control.token === token && (Number(control.childPid) > 0 || control.action === "failed")) return control;
    sleepSync(25);
  }
  return readKeepLiveControl();
}

function writeKeepLiveState(state) {
  ensureStateDirs();
  atomicWriteJson(keepLiveStateFile(), state);
}

function startKeepLive({ automationRunId }) {
  const current = keepLiveStatus({
    automationRunId,
    command: keepLiveCommand(),
    args: keepLiveArgs(),
  });
  const leases = touchKeepLiveLease(current.leases, automationRunId);
  if (!current.enabled) {
    const state = { ...current, leases: {}, activeAutomationRunIds: [], activeRunCount: 0, active: false, status: "stopped", stopReason: "disabled", pid: 0, workerPid: 0, childPid: 0 };
    writeKeepLiveState(state);
    return { ...state, message: "disabled" };
  }
  if (current.platform !== "darwin") {
    const state = { ...current, leases: {}, activeAutomationRunIds: [], activeRunCount: 0, active: false, status: "stopped", stopReason: "non-darwin", pid: 0, workerPid: 0, childPid: 0 };
    writeKeepLiveState(state);
    return { ...state, message: "macOS only" };
  }
  if (current.active) {
    const activeAutomationRunIds = keepLiveLeaseIds(leases);
    const state = {
      ...current,
      automationRunId: current.automationRunId || automationRunId,
      requestedAutomationRunId: automationRunId,
      leases,
      activeAutomationRunIds,
      activeRunCount: activeAutomationRunIds.length,
      status: "running",
    };
    writeKeepLiveState(state);
    return { ...state, message: "already running" };
  }

  const token = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeKeepLiveControl({
    version: keepLiveVersion,
    action: "run",
    token,
    automationRunId,
    requestedAt: nowIso(),
    command: current.command,
    args: current.args,
    workerPid: 0,
    childPid: 0,
  });

  try {
    const worker = spawn(process.execPath, keepLiveWorkerArgs(current, token, automationRunId), {
      detached: true,
      stdio: "ignore",
    });
    worker.unref?.();
    const control = readWorkerControl(token);
    if (!worker.pid || control.action === "failed") {
      const state = {
        ...current,
        automationRunId,
        active: false,
        status: "failed",
        token,
        pid: 0,
        workerPid: 0,
        childPid: 0,
        error: control.error || "worker did not start",
      };
      writeKeepLiveState(state);
      return { ...state, message: "failed" };
    }
    const state = {
      ...current,
      automationRunId,
      active: true,
      workerActive: true,
      childActive: Number(control.childPid) > 0,
      leases,
      activeAutomationRunIds: keepLiveLeaseIds(leases),
      activeRunCount: keepLiveLeaseIds(leases).length,
      status: "running",
      token,
      pid: worker.pid,
      workerPid: worker.pid,
      childPid: Number(control.childPid) || 0,
      startedAt: nowIso(),
      stoppedAt: undefined,
      stopReason: "",
      error: null,
    };
    writeKeepLiveState(state);
    return { ...state, message: "started" };
  } catch (error) {
    const state = {
      ...current,
      automationRunId,
      active: false,
      status: "failed",
      token,
      pid: 0,
      workerPid: 0,
      childPid: 0,
      error: error.message,
    };
    writeKeepLiveState(state);
    return { ...state, message: "failed" };
  }
}

function stopKeepLive({ automationRunId = "", reason = "" } = {}) {
  const current = keepLiveStatus();
  const stopReason = reason || "stopped";
  const release = releaseKeepLiveLease(current.leases, automationRunId);
  const remainingIds = release.remainingIds;
  if (!current.active) {
    const state = {
      ...current,
      automationRunId: automationRunId || current.automationRunId,
      requestedAutomationRunId: automationRunId || undefined,
      leases: {},
      activeAutomationRunIds: [],
      activeRunCount: 0,
      active: false,
      workerActive: false,
      childActive: false,
      status: "stopped",
      pid: 0,
      workerPid: 0,
      childPid: 0,
      token: "",
      stoppedAt: current.stoppedAt || nowIso(),
      stopReason,
      error: null,
    };
    writeKeepLiveState(state);
    return { ...state, message: current.status === "missing" ? "not started" : "not running" };
  }

  if (remainingIds.length > 0) {
    const state = {
      ...current,
      requestedAutomationRunId: automationRunId || undefined,
      releasedAutomationRunId: release.releasedAutomationRunId,
      leases: release.leases,
      activeAutomationRunIds: remainingIds,
      activeRunCount: remainingIds.length,
      active: true,
      status: "running",
      stopReason: `released ${release.releasedAutomationRunId || "no matching lease"}: ${stopReason}`,
      lastCheckedAt: nowIso(),
    };
    writeKeepLiveState(state);
    return {
      ...state,
      message: release.releasedAutomationRunId ? "lease released; keep-live still needed" : "keep-live still needed",
      retainedByOtherRuns: true,
    };
  }

  if (current.strategy === "watcher" && current.token) {
    writeKeepLiveControl({
      version: keepLiveVersion,
      action: "stop",
      token: current.token,
      automationRunId: automationRunId || current.automationRunId,
      requestedAt: nowIso(),
      reason: stopReason,
      workerPid: current.workerPid,
      childPid: current.childPid,
    });
    const workerExited = waitForPidExit(current.workerPid, 5000);
    const childExited = waitForPidExit(current.childPid, 3000);
    const workerActive = isPidRunning(current.workerPid);
    const childActive = isPidRunning(current.childPid);
    const state = {
      ...current,
      automationRunId: automationRunId || current.automationRunId,
      active: workerActive || childActive,
      workerActive,
      childActive,
      leases: {},
      activeAutomationRunIds: [],
      activeRunCount: 0,
      releasedAutomationRunId: release.releasedAutomationRunId,
      status: workerActive || childActive ? "failed" : "stopped",
      pid: workerActive ? current.workerPid : 0,
      workerPid: workerActive ? current.workerPid : 0,
      childPid: childActive ? current.childPid : 0,
      token: workerActive || childActive ? current.token : "",
      stoppedAt: workerActive || childActive ? undefined : nowIso(),
      stopReason,
      error: [
        workerExited ? "" : `worker pid ${current.workerPid} did not exit after stop marker`,
        childExited ? "" : `keep-live child pid ${current.childPid} did not exit after worker stop`,
      ].filter(Boolean).join("; ") || null,
    };
    writeKeepLiveState(state);
    return { ...state, message: state.active ? "stop failed" : "stopped" };
  }

  try {
    process.kill(current.workerPid, "SIGTERM");
  } catch (error) {
    const state = { ...current, status: "failed", error: error.message };
    writeKeepLiveState(state);
    return { ...state, message: "stop failed" };
  }
  const stopped = waitForPidExit(current.workerPid, 3000);
  const active = !stopped && isPidRunning(current.workerPid);
  const state = {
    ...current,
    automationRunId: automationRunId || current.automationRunId,
    leases: {},
    activeAutomationRunIds: [],
    activeRunCount: 0,
    releasedAutomationRunId: release.releasedAutomationRunId,
    active,
    workerActive: active,
    childActive: false,
    status: active ? "failed" : "stopped",
    pid: active ? current.workerPid : 0,
    workerPid: active ? current.workerPid : 0,
    childPid: 0,
    token: active ? current.token : "",
    stoppedAt: active ? undefined : nowIso(),
    stopReason,
    error: active ? `pid ${current.workerPid} did not exit after SIGTERM` : null,
  };
  writeKeepLiveState(state);
  return { ...state, message: active ? "stop failed" : "stopped" };
}

function keepLiveWorkerCommandArgs(commandName, args) {
  if (process.platform === "darwin" && path.basename(commandName) === "caffeinate" && !args.includes("-w")) {
    return [...args, "-w", String(process.pid)];
  }
  return args;
}

function commandKeepLiveWorker() {
  const automationRunId = requireValue("--automation-run-id");
  const token = requireValue("--token");
  const commandName = keepLiveCommand();
  const childArgs = keepLiveWorkerCommandArgs(commandName, keepLiveArgs());
  let child = null;
  let exiting = false;
  let pollTimer = null;

  const writeWorkerState = (state) => {
    writeKeepLiveState({
      kind: "AutomationKeepLiveState",
      version: keepLiveVersion,
      enabled: true,
      automationRunId,
      mechanism: keepLiveMechanism(commandName),
      strategy: "watcher",
      platform: process.platform,
      command: commandName,
      args: childArgs,
      token,
      pid: process.pid,
      workerPid: process.pid,
      childPid: child?.pid || 0,
      lastCheckedAt: nowIso(),
      ...state,
    });
  };

  const stopChild = () => {
    if (!child?.pid || !isPidRunning(child.pid)) return;
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      return;
    }
    if (!waitForPidExit(child.pid, 1200)) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // Residual process state is surfaced by the parent stop command.
      }
    }
  };

  const exitWorker = (code = 0, state = {}) => {
    if (exiting) return;
    exiting = true;
    stopChild();
    writeWorkerState({
      active: false,
      workerActive: false,
      childActive: false,
      status: state.status || "stopped",
      stoppedAt: nowIso(),
      stopReason: state.stopReason || "worker exit",
      error: state.error || null,
    });
    if (pollTimer) clearInterval(pollTimer);
    process.exitCode = code;
  };

  try {
    child = spawn(commandName, childArgs, { stdio: "ignore" });
  } catch (error) {
    writeKeepLiveControl({
      version: keepLiveVersion,
      action: "failed",
      token,
      automationRunId,
      workerPid: process.pid,
      childPid: 0,
      updatedAt: nowIso(),
      error: error.message,
    });
    writeWorkerState({ active: false, status: "failed", error: error.message });
    process.exitCode = 1;
    return;
  }

  writeKeepLiveControl({
    version: keepLiveVersion,
    action: "run",
    token,
    automationRunId,
    workerPid: process.pid,
    childPid: child.pid || 0,
    updatedAt: nowIso(),
    command: commandName,
    args: childArgs,
  });
  writeWorkerState({
    active: true,
    workerActive: true,
    childActive: Boolean(child.pid),
    status: "running",
    startedAt: nowIso(),
    error: null,
  });

  child.on("exit", () => exitWorker(0, { stopReason: "keep-live child exited" }));
  process.on("SIGTERM", () => exitWorker(0, { stopReason: "worker SIGTERM" }));
  process.on("SIGINT", () => exitWorker(0, { stopReason: "worker SIGINT" }));

  pollTimer = setInterval(() => {
    const control = readKeepLiveControl();
    if (control.token === token && control.action === "stop") {
      exitWorker(0, { stopReason: control.reason || "stop marker" });
    }
    const state = readOptionalJson(keepLiveStateFile());
    if (state.token === token && state.status === "stopped") {
      exitWorker(0, { stopReason: state.stopReason || "state stopped" });
    }
  }, 500).unref?.();
}

function validateThreadId(value) {
  const threadId = String(value ?? "").trim();
  const placeholders = new Set(["current-codex-thread", "current thread", "<thread id>", "unknown", ""]);
  if (placeholders.has(threadId.toLowerCase())) {
    fail("--thread-id must be a real Codex thread id, not a placeholder.");
  }
  if (/\s/.test(threadId)) {
    fail("--thread-id must not contain whitespace.");
  }
  return threadId;
}

function readWorkspaceConfig() {
  for (const candidate of [
    path.join(workspaceRoot, ".workspace-local/workspace.config.json"),
    path.join(workspaceRoot, "workspace.config.json"),
  ]) {
    if (existsSync(candidate)) return readJson(candidate, "workspace config");
  }
  return {};
}

function repositoryForWindow(windowName) {
  const config = readWorkspaceConfig();
  const repositories = Array.isArray(config.repositories) ? config.repositories : [];
  return {
    config,
    repository: repositories.find((item) => item.windowName === windowName) ?? null,
  };
}

function deliveryRoleForWindow(config, windowName) {
  if (windowName === config.controllerWindow) return "controller";
  if (windowName === config.designWindow) return "design";
  if (windowName === config.testWindow) return "test-target";
  return "target";
}

function windowRuntimeDescriptor(windowName) {
  const { config, repository } = repositoryForWindow(windowName);
  return {
    config,
    repository,
    deliveryRole: deliveryRoleForWindow(config, windowName),
    cwd: repository?.path,
    responsibilityRoot: repository?.path,
  };
}

function formatTargetPrompt({
  targetWindow,
  taskId,
  dispatchGroup,
  controllerWindow,
  humanContextRef = "",
  stateRef,
}) {
  if (!stateRef) fail("Target prompts require stateRef from a controller state root.");
  return [
    `Continue current window task: ${targetWindow} / ${taskId}.`,
    "",
    "Variables:",
    `- currentWindow: ${targetWindow}`,
    `- taskId: ${taskId}`,
    `- stateRoot: ${stateRef.stateRoot}`,
    ...(dispatchGroup ? [`- dispatchGroup: ${dispatchGroup}`] : []),
    "- skill: skills/wakeflow-target/SKILL.md",
  ].join("\n");
}

function formatControllerReturnPrompt({
  dispatchGroup,
  controllerWindow,
  triggerTarget,
  triggerTaskId,
  humanContextRef = "",
  stateRef,
  returnPolicy,
  reviewScope,
  groupSnapshot,
}) {
  if (!stateRef) fail("Controller return prompts require stateRef from a controller state root.");
  const returnedTargets = [
    ...(groupSnapshot.readyTargets || []),
    ...(groupSnapshot.blockedTargets || []),
  ];
  const titleTargets = reviewScope === "group"
    ? formatPromptTargetList(returnedTargets)
    : triggerTarget;
  const title = reviewScope === "group"
    ? `Continue controller review: ${titleTargets} backfill.`
    : `Continue controller review: ${triggerTarget} backfill.`;
  const blockedTargets = formatPromptTargetList(groupSnapshot.blockedTargets);
  const remainingTargets = formatPromptTargetList(groupSnapshot.missingTargets);
  const hasBlockedTargets = Array.isArray(groupSnapshot.blockedTargets) && groupSnapshot.blockedTargets.length > 0;
  const hasRemainingTargets = Array.isArray(groupSnapshot.missingTargets) && groupSnapshot.missingTargets.length > 0;
  return [
    title,
    "",
    "Variables:",
    `- stateRoot: ${stateRef.stateRoot}`,
    `- dispatchGroup: ${dispatchGroup}`,
    `- trigger: ${triggerTarget} / ${triggerTaskId}`,
    ...(hasBlockedTargets ? [`- blockedTargets: ${blockedTargets}`] : []),
    ...(hasRemainingTargets ? [`- remainingTargets: ${remainingTargets}`] : []),
    "- skill: skills/wakeflow-controller/SKILL.md",
  ].join("\n");
}

function commandRegisterThread() {
  if (!write) fail("register-thread requires --write.");
  const windowName = requireValue("--window");
  const threadId = validateThreadId(requireValue("--thread-id"));
  const registration = {
    kind: "CodexWindowThreadRegistration",
    version: threadRegistrationVersion,
    windowName,
    threadId,
    registeredAt: nowIso(),
    lastVerifiedAt: nowIso(),
  };
  ensureStateDirs();
  atomicWriteJson(threadFileFor(windowName), registration);
  output(
    {
      ok: true,
      command: "register-thread",
      wrote: true,
      windowName,
      threadRegistered: true,
      threadIdRedacted: true,
      registryFile: path.relative(workspaceRoot, threadFileFor(windowName)),
    },
    [`Registered Codex thread for ${windowName}.`],
  );
}

function loadThreadRegistration(windowName) {
  const file = threadFileFor(windowName);
  if (!existsSync(file)) return null;
  const registration = readJson(file, "thread registration");
  if (registration.kind !== "CodexWindowThreadRegistration") {
    fail(`Invalid thread registration for ${windowName}.`);
  }
  if (!registration.threadId) {
    fail(`Thread registration for ${windowName} is missing threadId.`);
  }
  return {
    kind: "CodexWindowThreadRegistration",
    version: threadRegistrationVersion,
    windowName: registration.windowName || windowName,
    threadId: registration.threadId,
    registeredAt: registration.registeredAt,
    lastVerifiedAt: registration.lastVerifiedAt,
    threadRegistryFile: path.relative(stateDir, file),
  };
}

function redactDeliveryEnvelope(envelope) {
  const redacted = structuredClone(envelope);
  if (redacted.targetThread?.threadId) {
    redacted.targetThread.threadId = "<redacted>";
  }
  return redacted;
}

function deliveryRunsFor(deliveryId) {
  return listJsonFiles(dirs.deliveryRuns)
    .map((file) => ({
      file,
      run: readJson(file, "delivery run"),
    }))
    .filter((item) => item.run.kind === "DirectThreadDeliveryRun" && item.run.deliveryId === deliveryId)
    .sort((a, b) => String(a.run.createdAt || "").localeCompare(String(b.run.createdAt || "")));
}

function deliveryRunStatusForEnvelope(envelope) {
  const runs = deliveryRunsFor(envelope.deliveryId);
  const sentRun = runs.findLast?.((item) => item.run.status === "sent" && item.run.readback?.ok === true)
    || [...runs].reverse().find((item) => item.run.status === "sent" && item.run.readback?.ok === true);
  const latestRun = runs[runs.length - 1] || null;
  const status = sentRun
    ? "sent"
    : runs.length === 0
      ? "pending-host-send"
      : latestRun.run.status;

  return {
    deliveryId: envelope.deliveryId,
    kind: envelope.kind,
    targetWindow: envelope.targetWindow || envelope.targetThread?.windowName,
    taskId: envelope.taskId || envelope.triggerTaskId,
    dispatchGroup: envelope.dispatchGroup,
    triggerTarget: envelope.triggerTarget,
    triggerTaskId: envelope.triggerTaskId,
    reviewScope: envelope.reviewScope,
    returnPolicy: envelope.returnPolicy,
    groupStatus: envelope.groupSnapshot?.groupStatus,
    status,
    sent: Boolean(sentRun),
    readbackOk: Boolean(sentRun?.run.readback?.ok),
    runCount: runs.length,
    latestRunFile: latestRun ? path.relative(workspaceRoot, latestRun.file) : undefined,
  };
}

function markStateRootDeliverySent(envelope, run) {
  if (envelope.kind !== "DeliveryEnvelope" || run.status !== "sent") {
    return { updated: false, reason: "not-a-sent-target-delivery" };
  }
  const stateRootRef = envelope.stateRef?.stateRoot;
  const targetTaskId = envelope.stateRef?.targetTaskId || envelope.taskId;
  const taskPackageId = envelope.stateRef?.taskPackageId;
  if (!stateRootRef || !targetTaskId || !taskPackageId) {
    return { updated: false, reason: "missing-state-ref" };
  }

  const stateRoot = resolveStateRoot(stateRootRef);
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const eventsFile = path.join(stateRoot, "controller-events.jsonl");
  const state = readJson(stateFile, "controller state");
  const targetTask = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
  if (!targetTask) {
    fail(`delivery run targets unknown state task: ${targetTaskId}`);
  }
  if (envelope.targetWindow && targetTask.targetWindow !== envelope.targetWindow) {
    fail(`delivery run target window mismatch: state has ${targetTask.targetWindow}, envelope has ${envelope.targetWindow}`);
  }
  if (targetTask.taskPackageId !== taskPackageId) {
    fail(`delivery run task package mismatch: state has ${targetTask.taskPackageId}, envelope has ${taskPackageId}`);
  }
  if (["accepted", "completed", "blocked", "needs-review"].includes(targetTask.status)) {
    return { updated: false, reason: `target-task-already-${targetTask.status}` };
  }

  const createdAt = nowIso();
  const nextRevision = Number(state.revision ?? 0) + 1;
  const eventId = eventIdFor(createdAt, nextRevision);
  const nextTargetTasks = (state.targetTasks ?? []).map((item) => item.targetTaskId === targetTaskId
    ? {
        ...item,
        status: "sent",
        delivery: {
          deliveryId: envelope.deliveryId,
          deliveryRunId: run.deliveryRunId,
          dispatchGroup: envelope.dispatchGroup,
          sentAt: run.createdAt,
          readbackOk: Boolean(run.readback?.ok),
        },
      }
    : item);
  const nextTaskPackages = (state.taskPackages ?? []).map((item) => item.taskPackageId === taskPackageId
    ? { ...item, status: item.status === "accepted" ? item.status : "sent" }
    : item);
  const nextWindows = (state.windows ?? []).map((item) => item.windowName === targetTask.targetWindow
    ? { ...item, windowState: "active" }
    : item);
  const nextState = {
    ...state,
    state: "dispatched",
    stateReason: `delivery sent: ${targetTaskId}`,
    revision: nextRevision,
    updatedAt: createdAt,
    allowedActions: ["import-target-result", "reduce-results", "wakeflow-render-progress"],
    taskPackages: nextTaskPackages,
    targetTasks: nextTargetTasks,
    windows: nextWindows,
    delivery: {
      ...(state.delivery ?? {}),
      lastDeliveryId: envelope.deliveryId,
      lastDeliveryRunId: run.deliveryRunId,
      lastDispatchGroup: envelope.dispatchGroup,
      lastTargetTaskId: targetTaskId,
      lastStatus: "sent",
      updatedAt: createdAt,
    },
    projection: {
      ...(state.projection ?? {}),
      status: "stale",
    },
  };
  const event = {
    eventId,
    createdAt,
    actor: "delivery-runtime",
    type: "delivery.sent",
    from: state.state,
    to: "dispatched",
    reason: `delivery run recorded as sent: ${run.deliveryRunId}`,
    evidenceRefs: [path.relative(workspaceRoot, deliveryRunFileFor(run.deliveryRunId))],
    allowedWrites: [
      "wakeflow-state.json",
      "controller-events.jsonl",
    ],
    forbiddenConclusions: [
      "delivery-sent-is-target-result",
      "delivery-sent-is-controller-acceptance",
      "delivery-sent-starts-polling",
    ],
    stateRevision: nextRevision,
  };

  atomicWriteJson(stateFile, nextState);
  appendJsonLine(eventsFile, event);
  return {
    updated: true,
    stateRoot: path.relative(workspaceRoot, stateRoot),
    targetTaskId,
    taskPackageId,
    stateRevision: nextRevision,
    eventId,
    projectionStatus: "stale",
  };
}

function controllerReturnDeliveryStatusForGroup(dispatchGroup) {
  if (!dispatchGroup) {
    return {
      status: "not-applicable",
      dispatchGroup: undefined,
      envelopeCount: 0,
      sentCount: 0,
      pendingCount: 0,
      failedCount: 0,
      blockedCount: 0,
      deliveries: [],
    };
  }

  const deliveries = listJsonFiles(dirs.deliveries)
    .map((file) => ({
      file,
      envelope: readJson(file, "delivery envelope"),
    }))
    .filter((item) => item.envelope.kind === "ControllerReturnEnvelope" && item.envelope.dispatchGroup === dispatchGroup)
    .map((item) => ({
      file: path.relative(workspaceRoot, item.file),
      ...deliveryRunStatusForEnvelope(item.envelope),
    }));

  const sentCount = deliveries.filter((item) => item.status === "sent").length;
  const pendingCount = deliveries.filter((item) => item.status === "pending-host-send").length;
  const failedCount = deliveries.filter((item) => item.status === "failed").length;
  const blockedCount = deliveries.filter((item) => item.status === "blocked").length;
  const status = deliveries.length === 0
    ? "not-built"
    : sentCount > 0
      ? "sent"
      : pendingCount > 0
        ? "pending-host-send"
        : failedCount > 0
          ? "failed"
          : blockedCount > 0
            ? "blocked"
            : "unknown";

  return {
    status,
    dispatchGroup,
    envelopeCount: deliveries.length,
    sentCount,
    pendingCount,
    failedCount,
    blockedCount,
    deliveries,
  };
}

function targetDeliveryStatusesForPacket(packetId) {
  return listJsonFiles(dirs.deliveries)
    .map((file) => ({
      file,
      envelope: readJson(file, "delivery envelope"),
    }))
    .filter((item) => item.envelope.kind === "DeliveryEnvelope" && item.envelope.sourcePacketId === packetId)
    .map((item) => ({
      file: path.relative(workspaceRoot, item.file),
      ...deliveryRunStatusForEnvelope(item.envelope),
    }));
}

function evidenceRefSummary(ref) {
  const text = String(ref ?? "");
  const looksLikePath = text.includes("/") || /\.(json|md|log|txt|png|jpg|jpeg|webp|html|csv)$/i.test(text);
  const resolvedPath = looksLikePath ? (path.isAbsolute(text) ? text : path.resolve(workspaceRoot, text)) : "";
  return {
    ref: text,
    looksLikePath,
    exists: Boolean(resolvedPath && existsSync(resolvedPath)),
    path: resolvedPath && existsSync(resolvedPath) ? path.relative(workspaceRoot, resolvedPath) : undefined,
  };
}

function missingEvidenceRefsFromSummaries(summaries) {
  return summaries
    .filter((item) => item.looksLikePath && !item.exists)
    .map((item) => item.ref);
}

function targetResultReviewEntry(item) {
  const result = item.result;
  const evidenceRefs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
  const verificationSummary = Array.isArray(result?.verificationSummary) ? result.verificationSummary : [];
  const commits = Array.isArray(result?.commits) ? result.commits : [];
  const evidenceRefSummaries = item.stateRoot
    ? evidenceRefs.map((ref) => stateRootEvidenceRefSummary(item.stateRoot, item.stateRootRef, ref))
    : evidenceRefs.map(evidenceRefSummary);
  const missingEvidenceRefs = missingEvidenceRefsFromSummaries(evidenceRefSummaries);
  return {
    packetId: item.packet.id,
    targetWindow: item.packet.targetWindow,
    taskId: item.packet.taskId,
    resultStatus: result?.status || "missing",
    resultFile: result ? path.relative(workspaceRoot, item.file) : undefined,
    changedRepos: Array.isArray(result?.changedRepos) ? result.changedRepos : [],
    commits,
    evidenceRefs,
    evidenceRefSummaries,
    missingEvidenceRefs,
    verificationSummary,
    riskSummary: Array.isArray(result?.riskSummary) ? result.riskSummary : [],
    nextSuggestion: result?.nextSuggestion,
    reportedAt: result?.reportedAt,
    hasControllerReviewEvidence: commits.length > 0 || evidenceRefs.length > 0 || verificationSummary.length > 0,
    targetDeliveries: targetDeliveryStatusesForPacket(item.packet.id),
    stateRootResult: Boolean(item.stateRootResult),
  };
}

function buildReviewPack(review) {
  const returnGroup = review.group || (review.packets.length === 1 ? review.packets[0].dispatchGroup : "");
  const controllerReturnDelivery = controllerReturnDeliveryStatusForGroup(returnGroup);
  const results = review.results.map(targetResultReviewEntry);
  const reviewReady = review.decision !== "wait";
  const missingEvidenceRefs = results.flatMap((item) => item.missingEvidenceRefs.map((ref) => ({
    targetWindow: item.targetWindow,
    taskId: item.taskId,
    ref,
  })));
  const missingEvidenceRefsPresent = missingEvidenceRefs.length > 0;
  const rawEvidenceRequired = results
    .filter((item) => item.resultStatus !== "missing")
    .map((item) => ({
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      resultStatus: item.resultStatus,
      commits: item.commits,
      evidenceRefs: item.evidenceRefs,
      verificationSummary: item.verificationSummary,
      hasControllerReviewEvidence: item.hasControllerReviewEvidence,
      missingEvidenceRefs: item.missingEvidenceRefs,
    }));
  const gates = {
    controllerReviewReady: reviewReady && !missingEvidenceRefsPresent,
    waitForMissingResults: review.decision === "wait",
    blockedResultsPresent: review.blocked.length > 0,
    missingEvidenceRefsPresent,
    evidenceRepairRequired: missingEvidenceRefsPresent,
    controllerReturnSent: controllerReturnDelivery.status === "sent",
    rawEvidencePullRequired: reviewReady,
    totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent,
  };
  return {
    kind: "ControllerReviewPack",
    version,
    dispatchGroup: review.group || undefined,
    taskId: review.taskId || undefined,
    decision: review.decision,
    returnPolicy: review.returnPolicy,
    groupStatus: review.groupStatus,
    groupSnapshot: review.groupSnapshot,
    controllerReturnDelivery,
    targetResults: results,
    rawEvidenceRequired,
    missingEvidenceRefs,
    gates,
    nextAction: review.decision === "wait"
      ? "wait-for-target-result-envelope"
      : review.decision === "blocked"
        ? "pull-block-evidence-and-classify"
        : missingEvidenceRefsPresent
          ? "fix-missing-evidence-refs-before-controller-verdict"
          : "pull-raw-evidence-and-make-total-control-verdict",
    generatedAt: nowIso(),
  };
}

function stateRootTargetResults(stateRoot) {
  const dir = path.join(stateRoot, "target-results");
  if (!existsSync(dir)) return [];
  return listJsonFiles(dir).map((file) => ({
    file,
    result: readJson(file, "state-root target result"),
  }));
}

function latestStateRootResultsByTargetTask(stateRoot) {
  const latest = new Map();
  for (const item of stateRootTargetResults(stateRoot)) {
    const existing = latest.get(item.result.targetTaskId);
    if (!existing || String(item.result.createdAt ?? "") >= String(existing.result.createdAt ?? "")) {
      latest.set(item.result.targetTaskId, item);
    }
  }
  return latest;
}

function normalizeStateRootResult(result) {
  const changedRepositories = Array.isArray(result?.changedRepositories) ? result.changedRepositories : [];
  const changedRepos = Array.isArray(result?.changedRepos)
    ? result.changedRepos
    : changedRepositories.map((item) => item.repository).filter(Boolean);
  const commits = Array.isArray(result?.commits)
    ? result.commits
    : changedRepositories.map((item) => item.head).filter(Boolean);
  return {
    kind: "TargetResultEnvelope",
    version,
    targetWindow: result?.targetWindow,
    taskId: result?.targetTaskId || result?.taskId,
    dispatchGroup: result?.dispatchGroup,
    status: result?.status,
    changedRepos,
    commits,
    evidenceRefs: Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [],
    verificationSummary: Array.isArray(result?.verificationSummary)
      ? result.verificationSummary
      : Array.isArray(result?.verification)
        ? result.verification
        : [],
    riskSummary: Array.isArray(result?.riskSummary)
      ? result.riskSummary
      : Array.isArray(result?.risks)
        ? result.risks
        : [],
    nextSuggestion: result?.nextSuggestion || result?.controllerActionRequired,
    reportedAt: result?.reportedAt || result?.createdAt,
  };
}

function stateRootResultForPacket({ packet, stateRoot, stateRootRef, resultsByTask }) {
  if (!stateRoot || !resultsByTask) return null;
  const item = resultsByTask.get(packet.taskId);
  if (!item) return null;
  if (item.result.targetWindow && item.result.targetWindow !== packet.targetWindow) {
    fail(`state-root target result window mismatch for ${packet.taskId}: result has ${item.result.targetWindow}, packet has ${packet.targetWindow}`);
  }
  return {
    packet,
    file: item.file,
    result: normalizeStateRootResult(item.result),
    stateRoot,
    stateRootRef,
    stateRootResult: true,
  };
}

function stateRootEvidenceRefSummary(stateRoot, stateRootRef, ref) {
  const text = String(ref ?? "");
  const looksLikePath = text.includes("/") || /\.(json|md|log|txt|png|jpg|jpeg|webp|html|csv)$/i.test(text);
  const absoluteRef = path.isAbsolute(text);
  const candidatePaths = looksLikePath
    ? absoluteRef
      ? [text]
      : [
          path.resolve(stateRoot, text),
          path.resolve(workspaceRoot, text),
        ]
    : [];
  const resolvedPath = candidatePaths.find((candidate) => existsSync(candidate)) || candidatePaths[0] || "";
  const stateRootCandidate = looksLikePath && !absoluteRef ? path.resolve(stateRoot, text) : "";
  return {
    ref: text,
    looksLikePath,
    exists: Boolean(resolvedPath && existsSync(resolvedPath)),
    path: resolvedPath && existsSync(resolvedPath) ? path.relative(workspaceRoot, resolvedPath) : undefined,
    stateRootRelativePath: stateRootCandidate ? path.join(stateRootRef, text) : undefined,
    resolvedAgainst: resolvedPath && existsSync(resolvedPath)
      ? (() => {
          const relativeToStateRoot = path.relative(stateRoot, resolvedPath);
          return !relativeToStateRoot.startsWith("..") && !path.isAbsolute(relativeToStateRoot) ? "state-root" : "workspace-root";
        })()
      : undefined,
  };
}

function buildStateRootReviewPack(stateRoot) {
  const { state, stateRootRef } = readControllerStateRoot(stateRoot);
  const resultsByTask = latestStateRootResultsByTargetTask(stateRoot);
  const targetTasks = state.targetTasks ?? [];
  const targetResults = targetTasks.map((task) => {
    const item = resultsByTask.get(task.targetTaskId);
    const result = item?.result ?? null;
    const evidenceRefs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
    const verificationSummary = Array.isArray(result?.verification) ? result.verification : [];
    const evidenceRefSummaries = evidenceRefs.map((ref) => stateRootEvidenceRefSummary(stateRoot, stateRootRef, ref));
    const missingEvidenceRefs = missingEvidenceRefsFromSummaries(evidenceRefSummaries);
    return {
      targetWindow: task.targetWindow,
      taskId: task.targetTaskId,
      taskPackageId: task.taskPackageId,
      resultId: result?.resultId,
      resultStatus: result?.status || "missing",
      resultFile: item ? path.relative(workspaceRoot, item.file) : undefined,
      evidenceRefs,
      evidenceRefSummaries,
      missingEvidenceRefs,
      verificationSummary,
      riskSummary: Array.isArray(result?.risks) ? result.risks : [],
      reportedAt: result?.createdAt,
      hasControllerReviewEvidence: evidenceRefs.length > 0 || verificationSummary.length > 0,
      stateRootResult: true,
    };
  });
  const missing = targetResults.filter((item) => item.resultStatus === "missing");
  const blocked = targetResults.filter((item) => item.resultStatus === "blocked");
  const ready = targetResults.filter((item) => item.resultStatus !== "missing" && item.resultStatus !== "blocked");
  const noTargetTasks = targetTasks.length === 0;
  const demandCompleted = state.state === "completed" || state.review?.status === "demand-completed";
  const decision = demandCompleted
    ? "completed"
    : noTargetTasks
    ? "no-target-tasks"
    : missing.length > 0
    ? "wait"
    : blocked.length > 0
      ? "blocked"
      : "needs-controller-review";
  const groupStatus = demandCompleted
    ? "completed"
    : noTargetTasks
    ? "empty"
    : missing.length > 0
    ? ready.length > 0 || blocked.length > 0 ? "partially-ready" : "waiting"
    : blocked.length > 0 ? "blocked" : "ready";
  const groupSnapshot = {
    groupId: state.demandKey,
    returnPolicy: { mode: "group-ready" },
    groupStatus,
    expected: targetResults.map((item) => ({
      packetId: item.taskId,
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      status: item.resultStatus,
      resultFile: item.resultFile,
    })),
    completed: targetResults.filter((item) => item.resultStatus === "completed"),
    ready,
    blocked,
    missing,
    needsReview: targetResults.filter((item) => item.resultStatus === "needs-review"),
    expectedTargets: [...new Set(targetTasks.map((item) => item.targetWindow))],
    completedTargets: [...new Set(targetResults.filter((item) => item.resultStatus === "completed").map((item) => item.targetWindow))],
    readyTargets: [...new Set(ready.map((item) => item.targetWindow))],
    blockedTargets: [...new Set(blocked.map((item) => item.targetWindow))],
    missingTargets: [...new Set(missing.map((item) => item.targetWindow))],
    allResultsPresent: missing.length === 0,
    stateRoot: stateRootRef,
  };
  const reviewReady = !demandCompleted && !noTargetTasks && decision !== "wait";
  const missingEvidenceRefs = targetResults.flatMap((item) => item.missingEvidenceRefs.map((ref) => ({
    targetWindow: item.targetWindow,
    taskId: item.taskId,
    ref,
  })));
  const missingEvidenceRefsPresent = missingEvidenceRefs.length > 0;
  return {
    kind: "ControllerReviewPack",
    version,
    source: "wakeflow-state-root",
    demandKey: state.demandKey,
    stateRoot: stateRootRef,
    stateRevision: state.revision,
    controllerState: state.state,
    decision,
    returnPolicy: groupSnapshot.returnPolicy,
    groupStatus,
    groupSnapshot,
    controllerReturnDelivery: {
      status: "not-applicable",
      reason: "state-root review pack is independent of controller-return delivery evidence",
    },
    targetResults,
    rawEvidenceRequired: targetResults
      .filter((item) => item.resultStatus !== "missing")
      .map((item) => ({
        targetWindow: item.targetWindow,
        taskId: item.taskId,
        resultStatus: item.resultStatus,
        evidenceRefs: item.evidenceRefs,
        verificationSummary: item.verificationSummary,
        hasControllerReviewEvidence: item.hasControllerReviewEvidence,
        missingEvidenceRefs: item.missingEvidenceRefs,
      })),
    missingEvidenceRefs,
    gates: {
      controllerReviewReady: reviewReady && !missingEvidenceRefsPresent,
      noTargetTasks,
      waitForMissingResults: decision === "wait",
      blockedResultsPresent: blocked.length > 0,
      missingEvidenceRefsPresent,
      evidenceRepairRequired: missingEvidenceRefsPresent,
      controllerReturnSent: false,
      rawEvidencePullRequired: reviewReady,
      totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent,
      stateRootBased: true,
    },
    nextAction: demandCompleted
      ? "demand-completed-stop-without-next-dispatch"
      : noTargetTasks
      ? "add-task-package-before-review"
      : decision === "wait"
      ? "wait-for-state-root-target-result"
      : decision === "blocked"
        ? "pull-block-evidence-and-run-wakeflow-state-reducer"
        : missingEvidenceRefsPresent
          ? "fix-missing-evidence-refs-before-wakeflow-state-reducer"
          : "pull-raw-evidence-and-run-wakeflow-state-reducer",
    forbiddenConclusions: [
      "review-pack-is-controller-acceptance",
      "review-pack-creates-next-dispatch",
      "review-pack-updates-developer-progress",
    ],
    generatedAt: nowIso(),
  };
}

function buildWindowConfig(windowName, { requireThread = false } = {}) {
  const registration = loadThreadRegistration(windowName);
  if (requireThread && !registration) fail(`No registered thread for window: ${windowName}`);
  const { config, repository, deliveryRole, cwd, responsibilityRoot } = windowRuntimeDescriptor(windowName);
  const dispatchWindows = new Set([
    ...(Array.isArray(config.dispatchWindows) ? config.dispatchWindows : []),
    ...(Array.isArray(config.requiredDispatchWindows) ? config.requiredDispatchWindows : []),
    config.controllerWindow,
  ].filter(Boolean));
  const dispatchable = ["controller", "target", "test-target"].includes(deliveryRole) && (dispatchWindows.size === 0 || dispatchWindows.has(windowName) || Boolean(registration));
  return {
    kind: "CodexSubwindowDispatchConfig",
    version: windowConfigVersion,
    windowName,
    repositoryPath: repository?.path,
    responsibility: repository?.role,
    dispatchable,
    threadRegistered: Boolean(registration),
    threadRegistryFile: path.relative(stateDir, threadFileFor(windowName)),
    cwd,
    responsibilityRoot,
    deliveryRole,
    delivery: {
      transport: "direct-thread",
      requireThread: true,
      missingThread: "fail-closed",
      readbackRequired: true,
    },
    automation: {
      mode: "manual-or-unattended",
      continuousWhenEnabled: true,
      keepLive: "required-when-automation-enabled",
    },
    result: {
      returnRoute: "controller",
      resultEnvelopeRequired: true,
    },
    generatedAt: nowIso(),
  };
}

function commandStatus() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(helpText);
    return;
  }
  const packetCount = listJsonFiles(dirs.packets).length;
  const groupCount = listJsonFiles(dirs.groups).length;
  const deliveryCount = listJsonFiles(dirs.deliveries).length;
  const deliveryRunCount = listJsonFiles(dirs.deliveryRuns).length;
  const resultCount = listJsonFiles(dirs.results).length;
  const registeredThreadCount = listJsonFiles(dirs.registry).length;
  const windowConfigCount = listJsonFiles(dirs.windowConfig).length;
  const keepLive = keepLiveStatus();
  const keepLiveStateExists = existsSync(keepLiveStateFile());
  output(
    {
      ok: true,
      command: "status",
      stateDir,
      packetCount,
      groupCount,
      deliveryCount,
      deliveryRunCount,
      resultCount,
      registeredThreadCount,
      windowConfigCount,
      keepLiveStateExists,
      keepLive,
    },
    [
      "Wakeflow delivery-loop status",
      `State: ${path.relative(workspaceRoot, stateDir) || "."}`,
      `Dispatch packets: ${packetCount}`,
      `Dispatch groups: ${groupCount}`,
      `Delivery envelopes: ${deliveryCount}`,
      `Delivery runs: ${deliveryRunCount}`,
      `Target results: ${resultCount}`,
      `Registered threads: ${registeredThreadCount}`,
      `Window configs: ${windowConfigCount}`,
      `Keep-live: ${keepLive.active ? `active worker=${keepLive.workerPid} child=${keepLive.childPid}` : keepLive.status}`,
    ],
  );
}

function commandBuildWindowConfig() {
  const windowName = requireValue("--window");
  const config = buildWindowConfig(windowName, { requireThread: hasFlag("--require-thread") });
  const configFile = windowConfigFileFor(windowName);
  if (write) {
    ensureStateDirs();
    atomicWriteJson(configFile, config);
  }
  output(
    {
      ok: true,
      command: "build-window-config",
      wrote: write,
      windowName,
      config,
      configFile: write ? path.relative(workspaceRoot, configFile) : "",
    },
    [
      `${write ? "Created" : "Would create"} window config for ${windowName}.`,
      `Thread: ${config.threadRegistered ? "registered" : "missing"}`,
      `Dispatchable: ${config.dispatchable ? "yes" : "no"}`,
    ],
  );
}

function buildDispatchArtifacts({
  contextPolicy,
  controllerWindow = "",
  dispatchGroup = "",
  evidenceRequired = [],
  forbidden = [],
  humanContextRef = "",
  objective,
  returnPolicyMode = "",
  scope = [],
  stateRef = null,
  targetWindow,
  taskId,
}) {
  if (!stateRef) fail("dispatch requires stateRef from controller state root.");
  if (returnPolicyMode && !dispatchGroup) fail("--return-policy requires --group.");
  if (returnPolicyMode) validateReturnPolicyMode(returnPolicyMode);
  const prompt = formatTargetPrompt({
    targetWindow,
    taskId,
    dispatchGroup,
    controllerWindow,
    humanContextRef,
    stateRef,
  });
  if (!prompt) fail("Prompt cannot be empty.");

  const id = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug).join("__");
  const dispatchGroupRecord = dispatchGroup
    ? upsertDispatchGroup({
        groupId: dispatchGroup,
        controllerWindow,
        humanContextRef,
        returnPolicyMode,
        stateRef,
        targetWindow,
        taskId,
        packetId: id,
      })
    : null;
  const packet = {
    kind: "ControllerDispatchPacket",
    version,
    id,
    targetWindow,
    taskId,
    dispatchGroup: dispatchGroup || undefined,
    controllerWindow: controllerWindow || undefined,
    humanContextRef: humanContextRef || undefined,
    stateRef: stateRef || undefined,
    objective,
    scope,
    forbidden,
    evidenceRequired,
    resultContract: "target-result-envelope-v1",
    returnPolicy: dispatchGroupRecord?.returnPolicy,
    contextPolicy: validateContextPolicy(contextPolicy || "refresh-if-missing"),
    prompt,
    createdAt: nowIso(),
  };

  const packetFile = packetFileFor(packet.id);
  return { dispatchGroupRecord, packet, packetFile };
}

function writeDispatchArtifacts({ dispatchGroup = "", dispatchGroupRecord, packet, packetFile }) {
  ensureStateDirs();
  if (dispatchGroupRecord && dispatchGroup) {
    atomicWriteJson(groupFileFor(dispatchGroup), dispatchGroupRecord);
  }
  atomicWriteJson(packetFile, packet);
}

function buildDeliveryArtifacts({
  automationEnabled = false,
  deliveryId = "",
  packet,
  requireThread = false,
  returnRoute = "controller",
  windowConfig = null,
}) {
  if (packet.kind !== "ControllerDispatchPacket") fail("Packet file must contain a ControllerDispatchPacket.");
  if (!packet.targetWindow || !packet.prompt || !packet.taskId) fail("Dispatch packet is missing targetWindow, taskId, or prompt.");
  if (!packet.stateRef) fail("Dispatch packet is missing stateRef; legacy Markdown-plan packets are no longer supported.");

  const registration = loadThreadRegistration(packet.targetWindow);
  if (requireThread && !registration) fail(`No registered thread for target window: ${packet.targetWindow}`);
  const resolvedWindowConfig = windowConfig || buildWindowConfig(packet.targetWindow);
  const resolvedDeliveryId = deliveryId || `delivery-${packet.id}`;
  const envelope = {
    kind: "DeliveryEnvelope",
    version: deliveryEnvelopeVersion,
    deliveryId: resolvedDeliveryId,
    sourcePacketId: packet.id,
    targetWindow: packet.targetWindow,
    taskId: packet.taskId,
    dispatchGroup: packet.dispatchGroup,
    controllerWindow: packet.controllerWindow,
    humanContextRef: packet.humanContextRef,
    stateRef: packet.stateRef,
    prompt: packet.prompt,
    returnPolicy: packet.returnPolicy,
    returnRoute: validateReturnRoute(returnRoute),
    oneShot: true,
    correlationId: packet.dispatchGroup || packet.id,
    targetThread: registration
      ? {
          windowName: registration.windowName,
          threadIdRedacted: true,
          threadRegistryFile: registration.threadRegistryFile,
        }
      : undefined,
    transport: {
      kind: "direct-thread",
      threadRegistryFile: path.relative(stateDir, threadFileFor(packet.targetWindow)),
      readbackRequired: true,
      missingThread: "fail-closed",
    },
    automation: {
      enabled: automationEnabled,
      continuousLoop: automationEnabled,
      keepLive: automationEnabled,
      keepLiveStateFile: automationEnabled ? path.relative(stateDir, keepLiveStateFile()) : undefined,
    },
    windowConfig: resolvedWindowConfig,
    createdAt: nowIso(),
  };

  const deliveryFile = deliveryFileFor(envelope.deliveryId);
  return { deliveryFile, envelope, registration };
}

function commandBuildDelivery() {
  const packetFile = resolveInputPath(requireValue("--packet-file"), "--packet-file");
  const packet = readJson(packetFile, "dispatch packet");
  const { deliveryFile, envelope, registration } = buildDeliveryArtifacts({
    automationEnabled: hasFlag("--automation-enabled"),
    deliveryId: getValue("--delivery-id", `delivery-${packet.id}`),
    packet,
    requireThread: hasFlag("--require-thread"),
    returnRoute: getValue("--return-route", "controller"),
  });
  if (write) {
    ensureStateDirs();
    atomicWriteJson(deliveryFile, envelope);
  }
  output(
    {
      ok: true,
      command: "build-delivery",
      wrote: write,
      envelope: redactDeliveryEnvelope(envelope),
      deliveryFile: write ? path.relative(workspaceRoot, deliveryFile) : "",
      threadReady: Boolean(registration),
      threadIdRedacted: Boolean(registration),
    },
    [
      `${write ? "Created" : "Would create"} delivery envelope ${envelope.deliveryId}.`,
      `Target: ${envelope.targetWindow}`,
      `Return route: ${envelope.returnRoute}`,
      `Thread: ${registration ? "registered" : "missing"}`,
    ],
  );
}

function validatePrepareDispatchEligibility({ state, taskPackage, targetTask }) {
  if (["completed", "archived", "paused", "blocked"].includes(state.state)) {
    fail(`cannot prepare dispatch while controller state is ${state.state}: ${state.demandKey}`);
  }
  if (["review-ready", "accepting"].includes(state.state)) {
    fail(`cannot prepare dispatch while controller state is ${state.state}; decide review before dispatching more work.`);
  }
  const eligibleTargetStatuses = new Set(["pending", "needs-rework", "missing-result"]);
  const targetStatus = targetTask.status || "pending";
  if (!eligibleTargetStatuses.has(targetStatus)) {
    fail(`target task ${targetTask.targetTaskId} is ${targetStatus}; only pending, needs-rework, or missing-result tasks can be dispatched.`);
  }
  const eligiblePackageStatuses = new Set(["pending", "needs-rework"]);
  const packageStatus = taskPackage.status || "pending";
  if (!eligiblePackageStatuses.has(packageStatus)) {
    fail(`task package ${taskPackage.taskPackageId} is ${packageStatus}; only pending or needs-rework packages can be dispatched.`);
  }
}

function commandPrepareDispatchFromState() {
  const stateRoot = resolveStateRoot(requireValue("--state-root"));
  const { state, stateRootRef } = readControllerStateRoot(stateRoot);
  const targetTaskId = requireValue("--target-task-id");
  const targetTask = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
  if (!targetTask) fail(`target task does not exist in controller state: ${targetTaskId}`);
  const taskPackageId = getValue("--task-package-id", targetTask.taskPackageId);
  if (!taskPackageId) fail(`target task ${targetTaskId} is missing taskPackageId.`);
  if (targetTask.taskPackageId && taskPackageId !== targetTask.taskPackageId) {
    fail(`target task ${targetTaskId} belongs to task package ${targetTask.taskPackageId}, not ${taskPackageId}`);
  }
  const taskPackage = readTaskPackageFromStateRoot(stateRoot, taskPackageId);
  const targetWindow = targetTask.targetWindow;
  if (!targetWindow) fail(`target task ${targetTaskId} is missing targetWindow.`);
  validatePrepareDispatchEligibility({ state, taskPackage, targetTask });
  const controllerWindow = getValue("--controller-window", "");
  const dispatchGroup = getValue("--group", taskPackageId);
  const automationEnabled = hasFlag("--automation-enabled");
  const requireThread = hasFlag("--require-thread");
  const windowConfig = buildWindowConfig(targetWindow, { requireThread });
  const humanContextRef = getValue(
    "--human-context-ref",
    state.projection?.progressDoc ? path.join(stateRootRef, state.projection.progressDoc) : stateRootRef,
  );
  const stateRef = {
    stateRoot: stateRootRef,
    demandKey: state.demandKey,
    taskPackageId,
    targetTaskId,
    stateRevision: state.revision,
  };
  const { dispatchGroupRecord, packet, packetFile } = buildDispatchArtifacts({
    contextPolicy: getValue("--context-policy", "refresh-if-missing"),
    controllerWindow,
    dispatchGroup,
    evidenceRequired: [
      ...getAllValues("--evidence"),
      "TargetResultEnvelope with evidence refs; target result is not controller acceptance.",
    ],
    forbidden: [
      ...getAllValues("--forbidden"),
      "Do not treat dispatch packet, delivery run, or target result as total-control acceptance.",
      "Do not parse developer-progress.md as state authority.",
    ],
    humanContextRef,
    objective: getValue("--objective", targetTask.summary || taskPackage.summary || `Complete ${targetTaskId}.`),
    returnPolicyMode: getValue("--return-policy", ""),
    scope: [
      ...getAllValues("--scope"),
      `demandKey=${state.demandKey}`,
      `taskPackageId=${taskPackageId}`,
      `targetTaskId=${targetTaskId}`,
    ],
    stateRef,
    targetWindow,
    taskId: targetTaskId,
  });
  const { deliveryFile, envelope, registration } = buildDeliveryArtifacts({
    automationEnabled,
    deliveryId: getValue("--delivery-id", `delivery-${packet.id}`),
    packet,
    requireThread,
    returnRoute: getValue("--return-route", "controller"),
    windowConfig,
  });

  let keepLive = null;
  if (write) {
    ensureStateDirs();
    if (automationEnabled) {
      keepLive = startKeepLive({ automationRunId: dispatchGroup || packet.id });
    }
    atomicWriteJson(windowConfigFileFor(targetWindow), windowConfig);
    writeDispatchArtifacts({ dispatchGroup, dispatchGroupRecord, packet, packetFile });
    atomicWriteJson(deliveryFile, envelope);
  }

  output(
    {
      ok: true,
      command: "prepare-dispatch-from-state",
      wrote: write,
      keepLive,
      stateRoot: stateRootRef,
      stateRevision: state.revision,
      taskPackageId,
      targetTaskId,
      humanContextRef,
      windowName: targetWindow,
      windowConfig,
      configFile: write ? path.relative(workspaceRoot, windowConfigFileFor(targetWindow)) : "",
      packet,
      dispatchGroup: dispatchGroupRecord,
      packetFile: write ? path.relative(workspaceRoot, packetFile) : "",
      dispatchGroupFile: write && dispatchGroupRecord ? path.relative(workspaceRoot, groupFileFor(dispatchGroup)) : "",
      envelope: redactDeliveryEnvelope(envelope),
      deliveryFile: write ? path.relative(workspaceRoot, deliveryFile) : "",
      threadReady: Boolean(registration),
      threadIdRedacted: Boolean(registration),
      forbiddenConclusions: [
        "prepared-dispatch-is-host-send",
        "prepared-dispatch-is-target-result",
        "prepared-dispatch-is-controller-acceptance",
      ],
    },
    [
      `${write ? "Prepared" : "Would prepare"} state-root dispatch + delivery for ${targetWindow} / ${targetTaskId}.`,
      `State root: ${stateRootRef}`,
      `Thread: ${registration ? "registered" : "missing"}`,
      `Delivery: ${path.relative(workspaceRoot, deliveryFile)}`,
    ],
  );
}

function commandBuildControllerReturn() {
  const dispatchGroup = requireValue("--group");
  const triggerTarget = requireValue("--trigger-target");
  const triggerTaskId = requireValue("--trigger-task-id");
  const config = readWorkspaceConfig();
  const explicitControllerWindow = getValue("--controller-window", "");
  const returnReason = validateReturnReason(getValue("--return-reason", "result-ready"));
  const automationEnabled = hasFlag("--automation-enabled");
  const review = computeReviewResults({ group: dispatchGroup });
  const inheritedStateRef = review.groupRecord?.stateRef
    || review.packets.find((packet) => packet.stateRef)?.stateRef
    || null;
  const inheritedHumanContextRef = review.groupRecord?.humanContextRef
    || review.packets.find((packet) => packet.humanContextRef)?.humanContextRef
    || "";
  const humanContextRef = getValue("--human-context-ref", inheritedHumanContextRef || "");
  if (!inheritedStateRef) {
    fail("build-controller-return requires stateRef from a state-root dispatch group.");
  }
  const storedControllerWindow = review.groupRecord?.controllerWindow
    || review.packets.find((packet) => packet.controllerWindow)?.controllerWindow
    || "";
  if (explicitControllerWindow && storedControllerWindow && explicitControllerWindow !== storedControllerWindow) {
    fail(`Dispatch group ${dispatchGroup} returns to controller ${storedControllerWindow}; cannot override with ${explicitControllerWindow}.`);
  }
  const controllerWindow = explicitControllerWindow || storedControllerWindow || config.controllerWindow || config.workspaceName || "Wakeflow";
  const registration = loadThreadRegistration(controllerWindow);
  if (hasFlag("--require-thread") && !registration) fail(`No registered controller thread for window: ${controllerWindow}`);
  validateControllerReturnAllowed({ review, triggerTarget, triggerTaskId });
  const existingReturn = controllerReturnDeliveryStatusForGroup(dispatchGroup);
  if (existingReturn.pendingCount > 0 || existingReturn.sentCount > 0) {
    fail(`Dispatch group ${dispatchGroup} already has controller-return delivery status ${existingReturn.status}; do not create duplicate controller returns.`);
  }
  const windowConfig = buildWindowConfig(controllerWindow);
  const reviewScope = review.returnPolicy.mode === "group-ready" ? "group" : "single-target";

  const prompt = formatControllerReturnPrompt({
    dispatchGroup,
    controllerWindow,
    triggerTarget,
    triggerTaskId,
    humanContextRef,
    stateRef: inheritedStateRef,
    returnPolicy: review.returnPolicy,
    reviewScope,
    groupSnapshot: review.groupSnapshot,
  });
  const envelope = {
    kind: "ControllerReturnEnvelope",
    version: deliveryEnvelopeVersion,
    deliveryId: `controller-return-${slug(dispatchGroup)}__${slug(triggerTarget)}__${slug(triggerTaskId)}`,
    dispatchGroup,
    controllerWindow,
    triggerTarget,
    triggerTaskId,
    returnPolicy: review.returnPolicy,
    groupSnapshot: review.groupSnapshot,
    reviewScope,
    humanContextRef: humanContextRef || undefined,
    stateRef: inheritedStateRef || undefined,
    prompt,
    oneShot: true,
    targetThread: registration
      ? {
          windowName: registration.windowName,
          threadIdRedacted: true,
          threadRegistryFile: registration.threadRegistryFile,
        }
      : undefined,
    transport: {
      kind: "direct-thread",
      threadRegistryFile: path.relative(stateDir, threadFileFor(controllerWindow)),
      readbackRequired: true,
      missingThread: "fail-closed",
    },
    automation: {
      enabled: automationEnabled,
      continuousLoop: automationEnabled,
      keepLive: automationEnabled,
      keepLiveStateFile: automationEnabled ? path.relative(stateDir, keepLiveStateFile()) : undefined,
    },
    deliveryCompletion: {
      required: true,
      pendingUntil: "host-send-readback-recorded",
      completionProof: "DirectThreadDeliveryRun status=sent with readback.ok=true",
      blockedAction: "record-delivery-run status=blocked or failed, then stop for total-control judgment",
    },
    loopGuard: {
      returnReason,
      reviewDecision: review.decision,
      groupStatus: review.groupStatus,
      controllerWindow,
      returnPolicy: review.returnPolicy,
      reviewScope,
      deliveryAllowedOnlyFor: ["result-ready", "blocked"],
      controllerReviewRequired: true,
      noEligibleTaskAction: "stop-without-next-delivery",
      repeatControllerReturnForbidden: true,
      nextDispatchAllowedOnlyWhen: [
        "current plan has eligible unfinished task",
        "target evidence requires controller rework dispatch",
        "user-approved unattended automation remains inside boundary",
      ],
    },
    windowConfig,
    createdAt: nowIso(),
  };

  const returnFile = deliveryFileFor(envelope.deliveryId);
  if (write) {
    ensureStateDirs();
    atomicWriteJson(returnFile, envelope);
  }
  output(
    {
      ok: true,
      command: "build-controller-return",
      wrote: write,
      envelope: redactDeliveryEnvelope(envelope),
      returnFile: write ? path.relative(workspaceRoot, returnFile) : "",
      threadReady: Boolean(registration),
      threadIdRedacted: Boolean(registration),
      deliveryStatus: "pending-host-send",
      deliveryCompletionRequired: true,
    },
    [
      `${write ? "Created" : "Would create"} controller-return envelope ${envelope.deliveryId}.`,
      `Controller: ${controllerWindow}`,
      `Thread: ${registration ? "registered" : "missing"}`,
      "Delivery: pending host send/readback/record-delivery-run",
    ],
  );
}

function commandRecordDeliveryRun() {
  if (!write) fail("record-delivery-run requires --write.");
  const deliveryFile = resolveInputPath(requireValue("--delivery-file"), "--delivery-file");
  const envelope = readJson(deliveryFile, "delivery envelope");
  if (!["DeliveryEnvelope", "ControllerReturnEnvelope"].includes(envelope.kind)) {
    fail("Delivery file must contain a DeliveryEnvelope or ControllerReturnEnvelope.");
  }
  const status = validateDeliveryRunStatus(requireValue("--status"));
  const readbackOk = parseBoolean(getValue("--readback-ok", ""), status === "sent");
  const evidence = getValue("--evidence", "");
  const error = getValue("--error", "");
  if (status === "sent" && (!readbackOk || !evidence.trim())) {
    fail("sent delivery runs require --readback-ok true and --evidence.");
  }
  if (status !== "sent" && !error.trim()) {
    fail("blocked/failed delivery runs require --error.");
  }
  const deliveryRunId = getValue("--delivery-run-id", `run-${envelope.deliveryId}`);
  const keepLiveState = envelope.automation?.keepLive ? path.relative(stateDir, keepLiveStateFile()) : null;
  const deliveryWindow = envelope.targetWindow || envelope.targetThread?.windowName || envelope.controllerWindow;
  const run = {
    kind: "DirectThreadDeliveryRun",
    version: deliveryRunVersion,
    deliveryRunId,
    deliveryId: envelope.deliveryId,
    targetWindow: deliveryWindow,
    taskId: envelope.taskId || envelope.triggerTaskId,
    dispatchGroup: envelope.dispatchGroup,
    triggerTarget: envelope.triggerTarget,
    triggerTaskId: envelope.triggerTaskId,
    reviewScope: envelope.reviewScope,
    transport: "direct-thread",
    status,
    thread: {
      windowName: deliveryWindow,
      threadIdRedacted: true,
      threadRegistryFile: envelope.transport?.threadRegistryFile || envelope.targetThread?.threadRegistryFile,
    },
    hostAction: {
      method: getValue("--host-method", "send_message_to_thread"),
      mode: validateHostMode(getValue("--host-mode", "unknown")),
    },
    readback: {
      checked: status === "sent" || getValue("--readback-ok", "") !== "",
      ok: readbackOk,
      evidence: evidence || undefined,
    },
    keepLive: {
      enabledForRun: Boolean(envelope.automation?.keepLive),
      stateFile: keepLiveState,
    },
    error: error || undefined,
    createdAt: nowIso(),
  };
  const runFile = deliveryRunFileFor(deliveryRunId);
  ensureStateDirs();
  atomicWriteJson(runFile, run);
  const stateUpdate = markStateRootDeliverySent(envelope, run);
  output(
    {
      ok: true,
      command: "record-delivery-run",
      wrote: true,
      status,
      run,
      runFile: path.relative(workspaceRoot, runFile),
      stateUpdate,
    },
    [
      `Recorded direct-thread delivery run ${deliveryRunId}.`,
      `Status: ${status}`,
    ],
  );
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

function commandSubmitResult() {
  const targetWindow = requireValue("--target-window");
  const taskId = requireValue("--task-id");
  const status = validateResultStatus(requireValue("--status"));
  const dispatchGroup = getValue("--group", "");
  const evidenceRefs = getAllValues("--evidence-ref");
  const verificationSummary = getAllValues("--verification");
  const commits = getAllValues("--commit");
  if (status === "completed" && evidenceRefs.length === 0 && verificationSummary.length === 0 && commits.length === 0) {
    fail("completed results require --evidence-ref, --verification, or --commit.");
  }

  const result = {
    kind: "TargetResultEnvelope",
    version,
    targetWindow,
    taskId,
    dispatchGroup: dispatchGroup || undefined,
    status,
    changedRepos: getAllValues("--changed-repo"),
    commits,
    evidenceRefs,
    verificationSummary,
    riskSummary: getAllValues("--risk"),
    nextSuggestion: getValue("--next-suggestion", "") || undefined,
    reportedAt: nowIso(),
  };

  const resultFile = resultFileFor(targetWindow, taskId, dispatchGroup);
  if (write) {
    ensureStateDirs();
    atomicWriteJson(resultFile, result);
  }
  output(
    {
      ok: true,
      command: "submit-result",
      wrote: write,
      result,
      resultFile: write ? path.relative(workspaceRoot, resultFile) : "",
    },
    [
      `${write ? "Recorded" : "Would record"} result envelope for ${targetWindow} / ${taskId}.`,
      `Status: ${status}`,
    ],
  );
}

function loadPacketsForScope({ group = "", taskId = "" } = {}) {
  if (!group && !taskId) fail("review-results requires --group or --task-id.");
  const packets = listJsonFiles(dirs.packets)
    .map((file) => readJson(file, "dispatch packet"))
    .filter((packet) => packet.kind === "ControllerDispatchPacket")
    .filter((packet) => (group ? packet.dispatchGroup === group : packet.taskId === taskId));
  return { group, taskId, packets };
}

function computeReviewResults({ group = "", taskId = "" } = {}) {
  const { packets } = loadPacketsForScope({ group, taskId });
  if (packets.length === 0) fail("No matching dispatch packets found for review.");
  const groupRecord = groupFromPackets({ groupId: group || packets[0]?.dispatchGroup || "", packets });
  const stateRootRef = groupRecord.stateRef?.stateRoot || packets.find((packet) => packet.stateRef?.stateRoot)?.stateRef?.stateRoot || "";
  const stateRoot = stateRootRef ? resolveStateRoot(stateRootRef) : null;
  const stateRootResultsByTask = stateRoot ? latestStateRootResultsByTargetTask(stateRoot) : null;
  const unorderedResults = packets.map((packet) => {
    const file = resultFileFor(packet.targetWindow, packet.taskId, packet.dispatchGroup);
    if (!existsSync(file)) {
      const stateRootResult = stateRootResultForPacket({
        packet,
        stateRoot,
        stateRootRef,
        resultsByTask: stateRootResultsByTask,
      });
      if (stateRootResult) return stateRootResult;
    }
    return {
      packet,
      file,
      result: existsSync(file) ? readJson(file, "target result") : null,
    };
  });
  const results = orderResultsByGroup({ groupRecord, results: unorderedResults });
  const groupSnapshot = buildGroupSnapshot({ groupRecord, results });
  const missing = groupSnapshot.missing.map((item) => item.packetId);
  const blocked = groupSnapshot.blocked.map((item) => item.packetId);
  const needsReview = groupSnapshot.ready.map((item) => item.packetId);
  const mode = groupSnapshot.returnPolicy.mode;
  const decision = mode === "per-target"
    ? groupSnapshot.groupStatus === "waiting"
      ? "wait"
      : groupSnapshot.blocked.length > 0 && groupSnapshot.ready.length === 0
        ? "blocked"
        : "needs-controller-review"
    : groupSnapshot.missing.length > 0
      ? "wait"
      : groupSnapshot.blocked.length > 0
        ? "blocked"
        : "needs-controller-review";
  return {
    group,
    taskId,
    groupRecord,
    returnPolicy: groupSnapshot.returnPolicy,
    groupStatus: groupSnapshot.groupStatus,
    groupSnapshot,
    packets,
    results,
    missing,
    blocked,
    needsReview,
    decision,
  };
}

function commandReviewResults() {
  const group = getValue("--group", "");
  const taskId = getValue("--task-id", "");
  const review = computeReviewResults({ group, taskId });
  const returnGroup = review.group || (review.packets.length === 1 ? review.packets[0].dispatchGroup : "");
  const controllerReturnDelivery = controllerReturnDeliveryStatusForGroup(returnGroup);

  output(
    {
      ok: true,
      command: "review-results",
      group: review.group || undefined,
      taskId: review.taskId || undefined,
      packetCount: review.packets.length,
      returnPolicy: review.returnPolicy,
      groupStatus: review.groupStatus,
      groupSnapshot: review.groupSnapshot,
      readyResults: review.groupSnapshot.ready,
      missingResults: review.groupSnapshot.missing,
      blockedResults: review.groupSnapshot.blocked,
      missing: review.missing,
      blocked: review.blocked,
      needsReview: review.needsReview,
      decision: review.decision,
      controllerReturnDeliveries: controllerReturnDelivery.deliveries,
      controllerReturnDelivery,
    },
    [
      `Review scope: ${group ? `group ${group}` : `task ${taskId}`}`,
      `Packets: ${review.packets.length}`,
      `Decision: ${review.decision}`,
      `Controller return delivery: ${controllerReturnDelivery.status}`,
    ],
  );
}

function commandReviewPack() {
  const stateRootArg = getValue("--state-root", "");
  if (stateRootArg) {
    const stateRoot = resolveStateRoot(stateRootArg);
    const reviewPack = buildStateRootReviewPack(stateRoot);
    output(
      {
        ok: true,
        command: "review-pack",
        source: "wakeflow-state-root",
        stateRoot: reviewPack.stateRoot,
        stateRevision: reviewPack.stateRevision,
        demandKey: reviewPack.demandKey,
        decision: reviewPack.decision,
        groupStatus: reviewPack.groupStatus,
        reviewPack,
      },
      [
        `Review pack: state root ${reviewPack.stateRoot}`,
        `Decision: ${reviewPack.decision}`,
        `Targets: ${reviewPack.groupSnapshot.expectedTargets.join(", ") || "(none)"}`,
        `Next: ${reviewPack.nextAction}`,
      ],
    );
    return;
  }
  const group = getValue("--group", "");
  const taskId = getValue("--task-id", "");
  const review = computeReviewResults({ group, taskId });
  const reviewPack = buildReviewPack(review);
  output(
    {
      ok: true,
      command: "review-pack",
      group: review.group || undefined,
      taskId: review.taskId || undefined,
      decision: review.decision,
      groupStatus: review.groupStatus,
      reviewPack,
    },
    [
      `Review pack: ${group ? `group ${group}` : `task ${taskId}`}`,
      `Decision: ${review.decision}`,
      `Targets: ${reviewPack.groupSnapshot.expectedTargets.join(", ") || "(none)"}`,
      `Next: ${reviewPack.nextAction}`,
    ],
  );
}

function commandStopLoop() {
  if (!write) fail("stop-loop requires --write.");
  const reason = requireValue("--reason");
  const keepLive = stopKeepLive({ automationRunId: getValue("--automation-run-id", ""), reason });
  const marker = {
    kind: "CodexAutomationLoopStop",
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

try {
  switch (command) {
    case "status":
      commandStatus();
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
    case "submit-result":
      commandSubmitResult();
      break;
    case "review-results":
      commandReviewResults();
      break;
    case "review-pack":
      commandReviewPack();
      break;
    case "stop-loop":
      commandStopLoop();
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
