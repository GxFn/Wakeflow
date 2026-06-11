#!/usr/bin/env node

/**
 * Claude Code host transport helper for Wakeflow tmux-resident windows.
 *
 * Wakeflow windows on Claude Code are interactive `claude` sessions living in
 * a tmux server session, one tmux window per Wakeflow window (controller
 * included). This helper wraps the tmux/claude invocations the controller
 * agent runs explicitly: it prepares and evidences transport, it never decides
 * dispatch, acceptance, or task content.
 *
 * Storage (dual-host layout):
 * - window bindings: .workspace-local/wakeflow-delivery/hosts/claude-code/window-host/<window>.json
 * - shared advisory locks: .workspace-local/wakeflow-delivery/locks/<window>.json
 * - shared results scanned by wait-results: .workspace-local/wakeflow-delivery/target-results/
 *
 * Environment overrides (used by tests): WAKEFLOW_TMUX_BIN, WAKEFLOW_CLAUDE_BIN.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostProfile } from "./wakeflow-host-profile.mjs";

// This helper IS the Claude Code host transport boundary, so it runs the host
// binaries (tmux, claude, brew, osascript) directly with a narrow no-shell
// wrapper instead of lib/wakeflow-process.mjs, whose whitelist intentionally
// keeps host commands out of the shared core runtime scripts.
function execHostText(command, args) {
  const hasUtf8 = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || "");
  const env = hasUtf8 ? process.env : { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, env });
  return {
    status: result.error ? 1 : result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || (result.error ? String(result.error.message) : ""),
  };
}

const HOST_DIR_NAME = "claude-code";
const BINDING_KIND = "ClaudeWindowHostBinding";
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "help";
const options = args[0] && !args[0].startsWith("--") ? args.slice(1) : args;

class CliExit extends Error {}

function fail(message) {
  throw new CliExit(message);
}

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = null) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] !== undefined && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function getAllValues(name) {
  const values = [];
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === name && options[index + 1] !== undefined) values.push(options[index + 1]);
    if (options[index].startsWith(`${name}=`)) values.push(options[index].slice(name.length + 1));
  }
  return values;
}

function requireValue(name) {
  const value = getValue(name);
  if (!value) fail(`${name} is required for ${command}.`);
  return value;
}

const workspaceRoot = path.resolve(getValue("--root", process.cwd()));
const stateDir = path.resolve(getValue("--state-dir", path.join(workspaceRoot, ".workspace-local/wakeflow-delivery")));
const hostDir = path.join(stateDir, "hosts", HOST_DIR_NAME);
const windowHostDir = path.join(hostDir, "window-host");
const locksDir = path.join(stateDir, "locks");
const resultsDir = path.join(stateDir, "target-results");
const tmuxBin = process.env.WAKEFLOW_TMUX_BIN || "tmux";
const claudeBin = process.env.WAKEFLOW_CLAUDE_BIN || "claude";

function defaultServerSession() {
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (existsSync(configFile)) {
    try {
      const session = JSON.parse(readFileSync(configFile, "utf8")).hosts?.["claude-code"]?.tmuxSession;
      if (typeof session === "string" && session.trim()) return session.trim();
    } catch {
      // fall through to the generic default
    }
  }
  return "wakeflow";
}

function roleOfWindow(windowName) {
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (!existsSync(configFile)) return "default";
  let config;
  try {
    config = JSON.parse(readFileSync(configFile, "utf8"));
  } catch {
    return "default";
  }
  if (windowName === config.controllerWindow) return "controller";
  if (windowName === config.designWindow) return "design";
  if (windowName === config.testWindow) return "test";
  const repos = Array.isArray(config.repositories) ? config.repositories : [];
  return repos.some((r) => r.windowName === windowName) ? "product" : "default";
}

function resolveEffortArgs(windowName, hostConfig) {
  // hosts.claude-code.effortByRole overrides the profile defaults; both are
  // keyed by role (controller/design/test/product) with a "default" fallback.
  const profileMap = hostProfile.launch.effortByRole ?? {};
  const configMap = hostConfig && typeof hostConfig.effortByRole === "object" ? hostConfig.effortByRole : {};
  const role = roleOfWindow(windowName);
  const effort = configMap[role] ?? configMap.default ?? profileMap[role] ?? profileMap.default;
  return effort ? ["--effort", effort] : [];
}

function nowIso() {
  return new Date().toISOString();
}

function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "window";
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${file}: ${error.message}`);
  }
  return null;
}

function tmux(tmuxArgs, { allowFailure = false } = {}) {
  const result = execHostText(tmuxBin, tmuxArgs);
  if (result.status !== 0 && !allowFailure) {
    fail(`tmux ${tmuxArgs.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

function bindingFileFor(windowName) {
  return path.join(windowHostDir, `${slug(windowName)}.json`);
}

function readBinding(windowName) {
  const file = bindingFileFor(windowName);
  if (!existsSync(file)) fail(`No window-host binding for ${windowName}; run launch-window first.`);
  const binding = readJson(file, "window-host binding");
  if (binding.kind !== BINDING_KIND) fail(`Invalid window-host binding kind for ${windowName}.`);
  return binding;
}

function windowAlive(binding) {
  const result = tmux(["list-windows", "-t", binding.tmux.server, "-F", "#{window_id}"], { allowFailure: true });
  if (result.status !== 0) return false;
  return result.stdout.split("\n").map((line) => line.trim()).includes(binding.tmux.windowId);
}

function lockFileFor(windowName) {
  return path.join(locksDir, `${slug(windowName)}.json`);
}

function readLock(windowName) {
  const file = lockFileFor(windowName);
  if (!existsSync(file)) return null;
  return readJson(file, "window delivery lock");
}

function lockIsFresh(lock) {
  if (!lock?.expiresAt) return false;
  return Date.parse(lock.expiresAt) > Date.now();
}

function setWindowState(windowName, state) {
  const file = bindingFileFor(windowName);
  if (!existsSync(file)) return;
  const binding = readJson(file, "window-host binding");
  if (state) {
    tmux(["set-option", "-w", "-t", binding.tmux.windowId, "@wakeflow_state", state], { allowFailure: true });
  } else {
    tmux(["set-option", "-w", "-u", "-t", binding.tmux.windowId, "@wakeflow_state"], { allowFailure: true });
  }
}

function getWindowState(binding) {
  const result = tmux(["show-options", "-w", "-v", "-t", binding.tmux.windowId, "@wakeflow_state"], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function capturePaneTail(binding, lines) {
  const result = tmux(["capture-pane", "-p", "-t", binding.tmux.windowId], { allowFailure: true });
  if (result.status !== 0) return "";
  const all = result.stdout.replace(/\s+$/, "").split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function commandPreflight() {
  const tmuxProbe = execHostText(tmuxBin, ["-V"]);
  const tmuxPresent = tmuxProbe.status === 0;
  const brewProbe = execHostText("brew", ["--version"]);
  const brewPresent = brewProbe.status === 0;
  const claudeProbe = execHostText(claudeBin, ["--version"]);
  const claudePresent = claudeProbe.status === 0;
  const recommendation = tmuxPresent
    ? "ready"
    : brewPresent
      ? "install-tmux"
      : "install-homebrew-then-tmux";
  output({
    ok: tmuxPresent && claudePresent,
    command: "preflight",
    tmux: { present: tmuxPresent, version: tmuxPresent ? tmuxProbe.stdout.trim() : null },
    claude: { present: claudePresent, version: claudePresent ? claudeProbe.stdout.trim() : null },
    brew: { present: brewPresent },
    recommendation,
    installCommand: tmuxPresent ? null : "brew install tmux  # retry once on a transient bottle error",
  });
}

function applyStatusOptions(serverSession) {
  // Keep the status bar readable with many wide window titles: short truncated
  // window tabs, a compact session label, and renumbering on close. Window
  // formats are set globally because the wakeflow tmux server is dedicated.
  const optionSets = [
    ["set-option", "-t", serverSession, "status-left", `[${serverSession}] `],
    ["set-option", "-t", serverSession, "status-left-length", "14"],
    ["set-option", "-t", serverSession, "status-right", ""],
    ["set-option", "-t", serverSession, "status-right-length", "0"],
    ["set-option", "-t", serverSession, "status-interval", "5"],
    ["set-option", "-t", serverSession, "renumber-windows", "on"],
    // Leading state glyph (the activity monitor sets @wakeflow_state): a bright
    // RUN marker for a live-executing window, then result/stall markers. The
    // glyph sits OUTSIDE the current-window reverse styling so "who is running"
    // is visible regardless of which window is selected.
    ["set-option", "-g", "window-status-format", `${STATE_GLYPH_FMT}#I:#{=14:window_name} `],
    ["set-option", "-g", "window-status-current-format", `${STATE_GLYPH_FMT}#[reverse,bold]#I:#{=16:window_name}#[noreverse] `],
    ["set-option", "-g", "window-status-separator", ""],
    ["set-option", "-t", serverSession, "base-index", "1"],
    // refresh fast enough that the running marker tracks live execution
    ["set-option", "-t", serverSession, "status-interval", "2"],
  ];
  for (const optionArgs of optionSets) tmux(optionArgs, { allowFailure: true });
}

// Leading glyph: running -> bright green ">>", done -> green "+", stalled ->
// red "!", busy(delivered, waiting) -> yellow ">", idle -> two spaces.
const STATE_GLYPH_FMT = "#{?#{==:#{@wakeflow_state},running},#[fg=green,bold,blink]>>#[default] ,"
  + "#{?#{==:#{@wakeflow_state},done},#[fg=green,bold]+ #[default],"
  + "#{?#{==:#{@wakeflow_state},stalled},#[fg=red,bold]! #[default],"
  + "#{?#{==:#{@wakeflow_state},busy},#[fg=yellow,bold]> #[default],   }}}}";

function paneShowsExecution(pane) {
  // Claude Code shows "esc to interrupt" in the input area while a turn runs.
  return /esc to interrupt/i.test(pane);
}

function activityMonitorPidFile(serverSession) {
  return path.join(hostDir, `activity-monitor-${slug(serverSession)}.pid`);
}

function activityMonitorRunning(serverSession) {
  const pidFile = activityMonitorPidFile(serverSession);
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startActivityMonitorDaemon(serverSession) {
  // One detached poller per server: it sets @wakeflow_state=running on windows
  // whose pane is mid-turn and clears it when idle. Single-instance via pidfile.
  if (activityMonitorRunning(serverSession)) return false;
  const selfPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [selfPath, "activity-monitor", "--root", workspaceRoot, "--server", serverSession], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

function ensureServer(serverSession) {
  const present = tmux(["has-session", "-t", serverSession], { allowFailure: true }).status === 0;
  if (!present) {
    tmux(["new-session", "-d", "-s", serverSession, "-c", workspaceRoot]);
  }
  applyStatusOptions(serverSession);
  return !present;
}

function commandEnsureServer() {
  const serverSession = getValue("--server", defaultServerSession());
  const created = ensureServer(serverSession);
  const monitorStarted = hasFlag("--no-monitor") ? false : startActivityMonitorDaemon(serverSession);
  output({ ok: true, command: "ensure-server", server: serverSession, created, activityMonitorStarted: monitorStarted });
}

async function commandActivityMonitor() {
  const serverSession = getValue("--server", defaultServerSession());
  const pollMs = Math.max(800, Number(getValue("--poll-ms", "1500")));
  const once = hasFlag("--once");
  const pidFile = activityMonitorPidFile(serverSession);
  if (!once) {
    mkdirSync(path.dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(process.pid));
  }
  let lastSummary = { running: [] };
  for (;;) {
    if (tmux(["has-session", "-t", serverSession], { allowFailure: true }).status !== 0) break;
    const listed = tmux(["list-windows", "-t", serverSession, "-F", "#{window_id}"], { allowFailure: true });
    const running = [];
    for (const wid of (listed.stdout || "").trim().split("\n").map((l) => l.trim()).filter(Boolean)) {
      const pane = tmux(["capture-pane", "-p", "-t", wid], { allowFailure: true }).stdout || "";
      const isRunning = paneShowsExecution(pane);
      const current = tmux(["show-options", "-w", "-v", "-t", wid, "@wakeflow_state"], { allowFailure: true }).stdout.trim();
      // The monitor owns the "running" state; it never clobbers dispatch markers
      // (done/stalled/busy) — it only adds/removes "running".
      if (isRunning && current !== "running") {
        tmux(["set-option", "-w", "-t", wid, "@wakeflow_state", "running"], { allowFailure: true });
      } else if (!isRunning && current === "running") {
        tmux(["set-option", "-w", "-u", "-t", wid, "@wakeflow_state"], { allowFailure: true });
      }
      if (isRunning) running.push(wid);
    }
    lastSummary = { running };
    if (once) break;
    await sleep(pollMs);
  }
  if (!once && existsSync(pidFile)) rmSync(pidFile, { force: true });
  output({ ok: true, command: "activity-monitor", server: serverSession, once, running: lastSummary.running });
}

function pastePromptFile(binding, promptFile) {
  const file = path.resolve(workspaceRoot, promptFile);
  if (!existsSync(file)) fail(`--prompt-file does not exist: ${promptFile}`);
  const bufferName = `wakeflow-${slug(binding.windowName)}-${Date.now()}`;
  tmux(["load-buffer", "-b", bufferName, file]);
  tmux(["paste-buffer", "-d", "-b", bufferName, "-t", binding.tmux.windowId]);
  tmux(["send-keys", "-t", binding.tmux.windowId, "Enter"]);
}

async function commandLaunchWindow() {
  const windowName = requireValue("--window");
  const title = getValue("--title", windowName);
  const cwd = path.resolve(workspaceRoot, requireValue("--cwd"));
  if (!existsSync(cwd)) fail(`--cwd does not exist: ${cwd}`);
  const serverSession = getValue("--server", defaultServerSession());
  const sessionId = getValue("--session-id", hasFlag("--resume") ? null : randomUUID());
  if (!sessionId) fail("--resume requires --session-id <registered session id> (read it from the thread registry).");
  const promptFile = getValue("--prompt-file");
  const bootWaitMs = Number(getValue("--boot-wait-ms", "6000"));
  const extraClaudeArgs = getAllValues("--claude-arg");

  ensureServer(serverSession);
  const existing = existsSync(bindingFileFor(windowName)) ? readJson(bindingFileFor(windowName), "window-host binding") : null;
  const existingAlive = Boolean(existing) && windowAlive({ tmux: existing.tmux });
  if (existingAlive && !hasFlag("--replace")) {
    fail(`Window ${windowName} already has a live tmux window (${existing.tmux.windowId}); pass --replace to relaunch.`);
  }
  if (existingAlive) {
    // --replace must not leak the old window: kill it before creating the new
    // one. tmux window ids are unique across the whole server, so this targets
    // the right window even if it previously lived under a different session.
    tmux(["kill-window", "-t", existing.tmux.windowId], { allowFailure: true });
  }

  // Repository windows must read the parent workspace (CLAUDE.md, state roots,
  // task packages), which lives outside their cwd; grant it at launch so entry
  // sync and deliveries do not stall on cross-directory read prompts.
  // --resume restores an existing registered session into a fresh tmux window
  // (cold start after reboot); the session id is stable across resumes.
  const sessionArgs = hasFlag("--resume") ? ["--resume", sessionId] : ["--session-id", sessionId];
  // Workspace-pinned claude flags (e.g. ["--effort", "max"]) come from
  // workspace.config.json hosts.claude-code.claudeArgs; per-call --claude-arg
  // values still append after them and win on conflicts.
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  const hostConfig = existsSync(configFile) ? (readJson(configFile, "workspace config").hosts?.["claude-code"] ?? {}) : {};
  const configClaudeArgs = Array.isArray(hostConfig.claudeArgs) && hostConfig.claudeArgs.every((arg) => typeof arg === "string")
    ? hostConfig.claudeArgs
    : [];
  // Per-role reasoning effort: controller=max, workers=high by default. Skip
  // when --effort is already supplied explicitly (per-call or global claudeArgs).
  const effortAlreadySet = extraClaudeArgs.includes("--effort") || configClaudeArgs.includes("--effort");
  const effortArgs = effortAlreadySet ? [] : resolveEffortArgs(windowName, hostConfig);
  // Permission mode precedence: explicit --claude-arg --permission-mode wins;
  // else workspace.config.json hosts.claude-code.permissionMode; else
  // acceptEdits so seeded allowlists keep the window prompt-free.
  const configMode = typeof hostConfig.permissionMode === "string" ? hostConfig.permissionMode : "acceptEdits";
  const modeArgs = extraClaudeArgs.includes("--permission-mode") ? [] : ["--permission-mode", configMode];
  const claudeCommand = [claudeBin, ...sessionArgs, "--add-dir", workspaceRoot, ...modeArgs, ...effortArgs, ...configClaudeArgs, ...extraClaudeArgs]
    .map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`)
    .join(" ");
  const created = tmux([
    "new-window",
    "-t", serverSession,
    "-n", title,
    "-c", cwd,
    "-P", "-F", "#{window_id}",
    claudeCommand,
  ]);
  const windowId = created.stdout.trim();
  if (!windowId.startsWith("@")) fail(`tmux did not return a window id: ${created.stdout}`);
  tmux(["set-option", "-w", "-t", windowId, "automatic-rename", "off"], { allowFailure: true });
  // A freshly launched/replaced window is idle — clear any inherited dispatch
  // glyph so it does not show a stale busy/done marker.
  tmux(["set-option", "-w", "-u", "-t", windowId, "@wakeflow_state"], { allowFailure: true });

  const binding = {
    kind: BINDING_KIND,
    version: 1,
    windowName,
    threadId: sessionId,
    cwd,
    tmux: { server: serverSession, windowId, title },
    createdAt: nowIso(),
  };
  writeJson(bindingFileFor(windowName), binding);

  await sleep(Number.isFinite(bootWaitMs) ? bootWaitMs : 6000);
  let trustAccepted = false;
  if (!hasFlag("--no-auto-trust")) {
    // The folder-trust dialog is always covered by the user's window-launch
    // authorization (they mapped this directory as a managed window). The
    // bypass-permissions consent is auto-confirmed ONLY when the user opted
    // into bypass mode in workspace.config.json: that recorded choice IS the
    // prior consent. A bypass prompt without that opt-in is left for the user.
    const trustPattern = /trust this folder|Do you trust/i;
    const bypassPattern = /bypass permissions|skip all permission|dangerously/i;
    const bypassConsented = configMode === "bypassPermissions";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pane = capturePaneTail(binding, 30);
      const isTrust = trustPattern.test(pane);
      const isBypass = bypassPattern.test(pane) && bypassConsented;
      if (!isTrust && !isBypass) break;
      tmux(["send-keys", "-t", binding.tmux.windowId, "Enter"]);
      trustAccepted = true;
      await sleep(2800);
    }
  }
  if (promptFile) {
    pastePromptFile(binding, promptFile);
  }

  output({
    ok: true,
    command: "launch-window",
    permissionMode: configMode,
    effort: effortArgs.length ? effortArgs[1] : (effortAlreadySet ? "explicit" : null),
    role: roleOfWindow(windowName),
    trustAccepted,
    windowName,
    title,
    server: serverSession,
    windowId,
    threadIdRedacted: true,
    sessionId,
    bindingFile: path.relative(workspaceRoot, bindingFileFor(windowName)),
    entryPromptSent: Boolean(promptFile),
    registerArgv: ["initialize", "--root", "<wakeflow-runtime-root>", "--thread", `${windowName}=${sessionId}`, "--write", "--json"],
    attach: `${tmuxBin} attach -t ${serverSession}`,
  });
}

function commandRetitle() {
  const windowName = requireValue("--window");
  const title = requireValue("--title");
  const binding = readBinding(windowName);
  if (!windowAlive(binding)) fail(`tmux window for ${windowName} is not alive; relaunch it first.`);
  tmux(["rename-window", "-t", binding.tmux.windowId, title]);
  binding.tmux.title = title;
  writeJson(bindingFileFor(windowName), binding);
  output({ ok: true, command: "retitle", windowName, title, windowId: binding.tmux.windowId });
}

async function commandSend() {
  const windowName = requireValue("--window");
  const promptFile = requireValue("--prompt-file");
  const deliveryId = getValue("--delivery-id", "");
  const lockTtlSec = Number(getValue("--lock-ttl-sec", "7200"));
  const binding = readBinding(windowName);
  if (!windowAlive(binding)) {
    fail(`tmux window for ${windowName} is not alive (${binding.tmux.windowId}); relaunch the same session interactively with launch-window --resume --session-id <registered id> --replace, then resend.`);
  }

  // Lock semantics (aligned with core dispatch): a fresh lock from the OTHER
  // host means another controller is driving this window's working tree — fail
  // closed. A SAME-host lock is advisory: the core per-task sent-state guard
  // already prevents true double-dispatch, and a controller-return to a window
  // that still holds its own inbound lock (the controller never produces a
  // self target-result to release it) must not deadlock. So warn and proceed.
  const lock = readLock(windowName);
  let lockWarning;
  if (lock && lockIsFresh(lock)) {
    const otherHost = lock.host && lock.host !== HOST_DIR_NAME;
    if (otherHost && !hasFlag("--force")) {
      fail(`Window ${windowName} has a fresh in-flight delivery lock from host ${lock.host} (${lock.deliveryId || "unknown delivery"}, expires ${lock.expiresAt}); wait for that delivery or pass --force.`);
    }
    lockWarning = `Proceeding over a fresh same-host delivery lock on ${windowName} (${lock.deliveryId || "no delivery id"}, created ${lock.createdAt}); the prior delivery's lock had no release path (e.g. a controller-return target).`;
  }
  writeJson(lockFileFor(windowName), {
    kind: "WakeflowWindowDeliveryLock",
    version: 1,
    windowName,
    host: HOST_DIR_NAME,
    deliveryId: deliveryId || undefined,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + (Number.isFinite(lockTtlSec) ? lockTtlSec : 7200) * 1000).toISOString(),
  });

  const before = capturePaneTail(binding, 5);
  pastePromptFile(binding, promptFile);
  setWindowState(windowName, "busy");
  await sleep(Number(getValue("--readback-wait-ms", "1200")));
  const paneTail = capturePaneTail(binding, Number(getValue("--lines", "25")));

  output({
    ok: true,
    command: "send",
    lockWarning,
    windowName,
    windowId: binding.tmux.windowId,
    deliveryId: deliveryId || undefined,
    sentAt: nowIso(),
    lockFile: path.relative(workspaceRoot, lockFileFor(windowName)),
    readback: {
      paneTail,
      paneChanged: paneTail !== before,
    },
  });
}

function commandReadback() {
  const windowName = requireValue("--window");
  const binding = readBinding(windowName);
  const alive = windowAlive(binding);
  output({
    ok: true,
    command: "readback",
    windowName,
    windowId: binding.tmux.windowId,
    alive,
    paneTail: alive ? capturePaneTail(binding, Number(getValue("--lines", "40"))) : "",
  });
}

function commandReleaseLock() {
  const windowName = requireValue("--window");
  const lock = readLock(windowName);
  if (lock) rmSync(lockFileFor(windowName), { force: true });
  setWindowState(windowName, null);
  output({ ok: true, command: "release-lock", windowName, released: Boolean(lock) });
}

function listGroupResults(group, stateRootDir) {
  // Target results land in two layers: the delivery store
  // (.workspace-local/wakeflow-delivery/target-results/) and the demand state
  // root (<state-root>/target-results/, written by the MCP record flow).
  // Scan both so the watcher wakes on either.
  const dirs = [resultsDir];
  if (stateRootDir) dirs.push(path.join(stateRootDir, "target-results"));
  const results = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        results.push(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
      } catch {
        // unreadable entries are skipped; the watcher only counts valid envelopes
      }
    }
  }
  return results.filter((result) => result && result.dispatchGroup === group);
}

async function commandWaitResults() {
  const group = requireValue("--group");
  const stateRootArg = getValue("--state-root");
  const stateRootDir = stateRootArg ? path.resolve(workspaceRoot, stateRootArg) : null;
  const expectedWindows = getAllValues("--target");
  const expectCount = Number(getValue("--expect", expectedWindows.length > 0 ? String(expectedWindows.length) : "1"));
  const timeoutSec = Number(getValue("--timeout-sec", "7200"));
  const pollMs = Math.max(250, Number(getValue("--poll-ms", "2000")));
  const deadline = Date.now() + (Number.isFinite(timeoutSec) ? timeoutSec : 7200) * 1000;

  let found = [];
  for (;;) {
    const results = listGroupResults(group, stateRootDir);
    const windows = [...new Set(results.map((result) => result.targetWindow).filter(Boolean))];
    found = expectedWindows.length > 0 ? windows.filter((window) => expectedWindows.includes(window)) : windows;
    for (const window of found) {
      const lock = readLock(window);
      // Release the lock only when it predates the arrived result for this
      // window, i.e. the lock belongs to the delivery whose result we now see.
      // A lock NEWER than every result is a fresh still-in-flight delivery and
      // must survive (otherwise wait-results could clear a delivery that has
      // not completed). Locks with no timestamp fall back to release.
      if (lock) {
        const windowResultTimes = results
          .filter((result) => result.targetWindow === window)
          .map((result) => Date.parse(result.createdAt || result.recordedAt || ""))
          .filter((value) => Number.isFinite(value));
        const newestResultAt = windowResultTimes.length ? Math.max(...windowResultTimes) : Date.now();
        const lockAt = Date.parse(lock.createdAt || "");
        if (!Number.isFinite(lockAt) || lockAt <= newestResultAt) {
          rmSync(lockFileFor(window), { force: true });
        }
      }
      setWindowState(window, "done");
    }
    const satisfied = expectedWindows.length > 0
      ? expectedWindows.every((window) => found.includes(window))
      : found.length >= expectCount;
    if (satisfied) {
      output({ ok: true, command: "wait-results", group, status: "ready", windows: found });
      return;
    }
    if (Date.now() >= deadline) {
      const missing = (expectedWindows.length > 0 ? expectedWindows : []).filter((window) => !found.includes(window));
      for (const window of missing) setWindowState(window, "stalled");
      output({
        ok: false,
        command: "wait-results",
        group,
        status: "stalled",
        windows: found,
        expected: expectedWindows.length > 0 ? expectedWindows : expectCount,
        note: "Timed out waiting for target results; review the dispatch as a stalled delivery instead of polling further.",
      });
      process.exitCode = 1;
      return;
    }
    await sleep(pollMs);
  }
}

function commandAttachWindow() {
  const windowName = requireValue("--window");
  const binding = readBinding(windowName);
  const attach = `${tmuxBin} attach -t ${binding.tmux.server} \\; select-window -t ${binding.tmux.windowId}`;
  let opened = "";
  if (hasFlag("--open-tab") || hasFlag("--open-terminal")) {
    // --open-tab opens a new tab in the CURRENT terminal app (iTerm2 preferred,
    // matching where the user already works); --open-terminal is kept as an
    // alias. Detect the host terminal from TERM_PROGRAM so an iTerm2 user never
    // gets a Terminal.app window. Inside tmux, switch-client is the right move
    // and no new tab is spawned.
    if (process.env.TMUX) {
      opened = "inside-tmux";
    } else if (process.platform === "darwin") {
      opened = openTabInTerminal(attach);
    } else {
      opened = "unsupported-platform";
    }
  }
  output({
    ok: true,
    command: "attach-window",
    windowName,
    windowId: binding.tmux.windowId,
    server: binding.tmux.server,
    attach,
    switchClient: `${tmuxBin} switch-client -t ${binding.tmux.server}`,
    opened,
  });
}

function openTabInTerminal(attachCommand) {
  const termProgram = process.env.TERM_PROGRAM || "";
  const cmd = attachCommand.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const iTermInstalled = existsSync("/Applications/iTerm.app");
  // iTerm2: create a new tab in the current window and run the attach there.
  if (termProgram === "iTerm.app" || (termProgram === "" && iTermInstalled)) {
    const script = [
      'tell application "iTerm2"',
      "  tell current window",
      `    create tab with default profile command "${cmd}"`,
      "  end tell",
      "  activate",
      "end tell",
    ].join("\n");
    const r = execHostText("osascript", ["-e", script]);
    if (r.status === 0) return "iterm2-tab";
    // current window may not exist (no iTerm window open): open a fresh one
    const fallback = `tell application "iTerm2" to create window with default profile command "${cmd}"`;
    const r2 = execHostText("osascript", ["-e", fallback, "-e", 'tell application "iTerm2" to activate']);
    if (r2.status === 0) return "iterm2-window";
    fail(`Failed to open iTerm2 tab: ${(r.stderr || r2.stderr || "").trim()}`);
  }
  // Terminal.app: do script opens a new window/tab and runs the command.
  const r = execHostText("osascript", ["-e", `tell application "Terminal" to do script "${cmd}"`, "-e", 'tell application "Terminal" to activate']);
  if (r.status !== 0) fail(`Failed to open Terminal window: ${(r.stderr || "").trim()}`);
  return "terminal-window";
}

function readWorkspaceWindowModel() {
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (!existsSync(configFile)) fail("workspace.config.json not found; run initialization first.");
  const config = readJson(configFile, "workspace config");
  const repositories = Array.isArray(config.repositories) ? config.repositories : [];
  const names = repositories.map((repo) => repo.windowName).filter(Boolean);
  const controller = config.controllerWindow;
  const design = config.designWindow;
  const test = config.testWindow;
  const products = names.filter((name) => ![design, test, controller].includes(name));
  return { controller, design, test, products };
}

function tabNameFor(role, windowName) {
  return hostProfile.launch.tabNames?.[role] ?? windowName;
}

const pluginRootDir = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));

function pluginVersion() {
  try {
    return JSON.parse(readFileSync(path.join(pluginRootDir, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function runtimeMetaFile() {
  return path.join(hostDir, "runtime-meta.json");
}

function settingsSeeded(dir, { isWorkspaceRoot }) {
  const file = path.join(dir, ".claude", "settings.json");
  if (!existsSync(file)) return "missing";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "invalid";
  }
  const allow = new Set(Array.isArray(parsed?.permissions?.allow) ? parsed.permissions.allow : []);
  const rulesOk = SEED_ALLOW_RULES.every((rule) => allow.has(rule));
  if (!rulesOk) return "partial";
  if (!isWorkspaceRoot) {
    const dirs = Array.isArray(parsed?.permissions?.additionalDirectories) ? parsed.permissions.additionalDirectories : [];
    if (!dirs.includes(workspaceRoot)) return "partial";
  }
  return "seeded";
}

function memoryFileState(dir) {
  const file = path.join(dir, "CLAUDE.md");
  if (!existsSync(file)) return "missing";
  const text = readFileSync(file, "utf8");
  const marker = dir === workspaceRoot ? "wakeflow:root-agents" : "wakeflow:scope";
  return text.includes(marker) ? "managed" : "unmanaged";
}

const PERMISSION_MODES = ["acceptEdits", "bypassPermissions", "default", "plan", "dontAsk", "auto"];

async function commandLaunchAll() {
  const serverSession = getValue("--server", defaultServerSession());
  const model = readWorkspaceWindowModel();
  const order = [model.design, model.controller, ...model.products, model.test].filter(Boolean);
  ensureServer(serverSession);
  const results = [];
  for (const windowName of order) {
    const registryFile = path.join(hostDir, "thread-registry", `${slug(windowName)}.json`);
    if (!existsSync(registryFile)) {
      results.push({ window: windowName, status: "skipped-unregistered", note: "Run /wakeflow:init or a single launch to register this window first." });
      continue;
    }
    const lock = readLock(windowName);
    if (lockIsFresh(lock)) {
      results.push({ window: windowName, status: "skipped-in-flight" });
      continue;
    }
    const sessionId = readJson(registryFile, "thread registration").threadId;
    const repo = readRepositoryForWindow(windowName);
    const title = repo.title;
    const argv = [
      "launch-window", "--root", workspaceRoot, "--server", serverSession,
      "--window", windowName, "--title", title, "--cwd", repo.cwd,
      "--resume", "--session-id", sessionId, "--replace", "--boot-wait-ms", getValue("--boot-wait-ms", "7000"),
    ];
    const r = execHostText(process.execPath, [process.argv[1], ...argv]);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* keep raw */ }
    results.push({
      window: windowName,
      status: parsed?.ok ? "resumed" : "failed",
      windowId: parsed?.windowId,
      permissionMode: parsed?.permissionMode,
      error: parsed?.ok ? undefined : (parsed?.error || (r.stderr || r.stdout).slice(-160)),
    });
  }
  // Order and rename the freshly resumed windows into the canonical short-tab
  // layout in one pass (launch-window appends at the tmux tail, so without this
  // the windows would be out of order and carry their long launch titles).
  const arranged = arrangeWindows(serverSession);
  output({ ok: results.every((x) => x.status === "resumed" || x.status.startsWith("skipped")), command: "launch-all", server: serverSession, order, arranged, results });
}

function readRepositoryForWindow(windowName) {
  const config = readJson(path.join(workspaceRoot, "workspace.config.json"), "workspace config");
  // Titles are ASCII by design: CJK names were repeatedly mangled by shell
  // locale hops between the controller agent, tmux, and display surfaces.
  if (windowName === config.controllerWindow) {
    return { cwd: workspaceRoot, title: `${windowName} Controller` };
  }
  const repo = (Array.isArray(config.repositories) ? config.repositories : []).find((r) => r.windowName === windowName);
  if (!repo) return { cwd: workspaceRoot, title: windowName };
  const roleTitle = windowName === config.designWindow ? `${windowName} Design`
    : windowName === config.testWindow ? `${windowName} Test`
    : `${windowName} Work`;
  return { cwd: path.resolve(workspaceRoot, repo.path), title: roleTitle };
}

function commandSetUnattended() {
  const mode = requireValue("--mode");
  if (!PERMISSION_MODES.includes(mode)) {
    fail(`--mode must be one of ${PERMISSION_MODES.join(", ")}.`);
  }
  const write = hasFlag("--write");
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (!existsSync(configFile)) fail("workspace.config.json not found; run initialization first.");
  const config = readJson(configFile, "workspace config");
  const previous = config.hosts?.["claude-code"]?.permissionMode ?? "acceptEdits";
  if (write) {
    const hosts = config.hosts && typeof config.hosts === "object" ? config.hosts : {};
    const cc = hosts["claude-code"] && typeof hosts["claude-code"] === "object" ? hosts["claude-code"] : {};
    cc.permissionMode = mode;
    hosts["claude-code"] = cc;
    config.hosts = hosts;
    writeJson(configFile, config);
  }
  // Windows already running keep their launch-time mode; report which need a
  // resume-restart to pick up the new mode, and which are mid-turn (skip).
  const restart = [];
  if (existsSync(windowHostDir)) {
    for (const name of readdirSync(windowHostDir).filter((f) => f.endsWith(".json")).sort()) {
      const binding = readJson(path.join(windowHostDir, name), "window-host binding");
      const alive = windowAlive(binding);
      const lock = readLock(binding.windowName);
      restart.push({ window: binding.windowName, alive, needsRestart: alive, inFlight: lockIsFresh(lock) });
    }
  }
  output({
    ok: true,
    command: "set-unattended",
    wrote: write,
    previousMode: previous,
    mode,
    note: mode === "bypassPermissions"
      ? "Unattended mode: work windows run with no permission prompts. They stay bounded by repository worktrees, CLAUDE.md gates, and the Wakeflow state machine. Resume-restart live windows to apply; in-flight windows must finish first."
      : "Windows resume-restart into this mode; bypass auto-consent no longer applies.",
    restart,
  });
}

function commandWindowStatus() {
  const reconcile = hasFlag("--reconcile");
  const rows = [];
  if (existsSync(windowHostDir)) {
    for (const name of readdirSync(windowHostDir).filter((file) => file.endsWith(".json")).sort()) {
      const binding = readJson(path.join(windowHostDir, name), "window-host binding");
      const alive = windowAlive(binding);
      const lock = readLock(binding.windowName);
      const lockFresh = lockIsFresh(lock);
      if (reconcile && alive) {
        // busy follows the shared lock; transient done/stalled glyphs clear here
        setWindowState(binding.windowName, lockFresh ? "busy" : null);
      }
      rows.push({
        window: binding.windowName,
        tab: binding.tmux.title,
        alive,
        state: alive ? (reconcile ? (lockFresh ? "busy" : "") : getWindowState(binding)) : "no-window",
        lockFresh,
        deliveryId: lock?.deliveryId,
      });
    }
  }
  output({ ok: true, command: "window-status", reconciled: reconcile, windows: rows });
}

function commandCheckWorkspace() {
  const gaps = [];
  const note = (area, status, fix, extra = {}) => gaps.push({ area, status, fix, ...extra });

  const tmuxPresent = execHostText(tmuxBin, ["-V"]).status === 0;
  if (!tmuxPresent) note("binaries", "tmux-missing", "brew install tmux (retry once on a transient bottle error)");

  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (!existsSync(configFile)) {
    note("workspace-config", "missing", "Run /wakeflow:init for first-time initialization; check-workspace targets existing environments.");
    output({ ok: true, command: "check-workspace", pluginVersion: pluginVersion(), stamp: null, gaps });
    return;
  }
  const config = readJson(configFile, "workspace config");
  if (!config.hosts || typeof config.hosts !== "object" || !config.hosts["claude-code"]) {
    note("workspace-config", "hosts-block-missing", "Add hosts.claude-code (e.g. { \"tmuxSession\": \"wakeflow\" }) to workspace.config.json.");
  }

  const rootState = memoryFileState(workspaceRoot);
  if (rootState !== "managed") {
    note("root-memory-file", rootState, "wakeflow_initialize_workspace apply:true regenerates the managed CLAUDE.md gates. WARNING when unmanaged: the existing root CLAUDE.md content is replaced; confirm with the user first.", { file: "CLAUDE.md" });
  }

  const repositories = (Array.isArray(config.repositories) ? config.repositories : []).filter((repo) => repo && repo.windowName && repo.path);
  const windows = [config.controllerWindow, ...repositories.map((repo) => repo.windowName)].filter(Boolean);
  for (const repo of repositories) {
    const dir = path.resolve(workspaceRoot, repo.path);
    if (!existsSync(dir)) {
      note("repository", "directory-missing", "Confirm the repository path in workspace.config.json.", { window: repo.windowName });
      continue;
    }
    if (repo.managedAgents !== false) {
      const cardState = memoryFileState(dir);
      if (cardState !== "managed") {
        note("window-card", cardState, "wakeflow_initialize_workspace apply:true upserts the managed CLAUDE.md access card.", { window: repo.windowName });
      }
    }
    const seeded = settingsSeeded(dir, { isWorkspaceRoot: false });
    if (seeded !== "seeded") note("permissions", seeded, "wakeflow-claude-host seed-permissions --write", { window: repo.windowName });
  }
  const rootSeeded = settingsSeeded(workspaceRoot, { isWorkspaceRoot: true });
  if (rootSeeded !== "seeded") note("permissions", rootSeeded, "wakeflow-claude-host seed-permissions --write", { window: "workspace-root" });

  for (const windowName of windows) {
    const registryFile = path.join(hostDir, "thread-registry", `${slug(windowName)}.json`);
    if (!existsSync(registryFile)) {
      note("registry", "unregistered", "Launch and register via /wakeflow:windows <window> (full first launch).", { window: windowName });
      continue;
    }
    const bindingFile = bindingFileFor(windowName);
    if (!existsSync(bindingFile)) {
      note("window", "no-tmux-binding", "Restore with /wakeflow:windows <window> (launch-window --resume --session-id <registered id>).", { window: windowName });
      continue;
    }
    if (tmuxPresent) {
      const binding = readJson(bindingFile, "window-host binding");
      if (!windowAlive(binding)) {
        note("window", "dead", "Restore with /wakeflow:windows <window> (launch-window --resume --session-id <registered id>).", { window: windowName });
      }
    }
  }

  const legacyDir = path.join(stateDir, "thread-registry");
  if (existsSync(legacyDir) && readdirSync(legacyDir).some((name) => name.endsWith(".json"))) {
    note("legacy-codex-registry", "present", "Informational: pre-dual-host Codex registrations; the Codex plugin reads them via fallback. Not a Claude-side problem.");
  }

  let stamp = null;
  if (existsSync(runtimeMetaFile())) {
    stamp = readJson(runtimeMetaFile(), "runtime meta");
    if (stamp.pluginVersion !== pluginVersion()) {
      note("plugin-version", "stale", `Workspace last converged by ${stamp.pluginVersion}; current plugin is ${pluginVersion()}. Re-run the /wakeflow:check fix flow, then stamp-runtime --write.`);
    }
  } else {
    note("plugin-version", "unstamped", "After converging, record the version with wakeflow-claude-host stamp-runtime --write.");
  }

  output({
    ok: true,
    command: "check-workspace",
    pluginVersion: pluginVersion(),
    stamp,
    healthy: gaps.length === 0,
    gaps,
  });
}

function commandStampRuntime() {
  if (!hasFlag("--write")) fail("stamp-runtime requires --write.");
  const meta = {
    kind: "ClaudeHostRuntimeMeta",
    version: 1,
    pluginVersion: pluginVersion(),
    convergedAt: nowIso(),
  };
  writeJson(runtimeMetaFile(), meta);
  output({ ok: true, command: "stamp-runtime", meta, file: path.relative(workspaceRoot, runtimeMetaFile()) });
}

function commandArrangeWindows() {
  const serverSession = getValue("--server", defaultServerSession());
  const arranged = arrangeWindows(serverSession);
  output({ ok: true, command: "arrange-windows", server: serverSession, order: arranged });
}

function arrangeWindows(serverSession) {
  const model = readWorkspaceWindowModel();
  const desired = [
    { windowName: model.design, role: "design" },
    { windowName: model.controller, role: "controller" },
    ...model.products.map((windowName) => ({ windowName, role: "product" })),
    { windowName: model.test, role: "test" },
  ].filter((entry) => entry.windowName);

  const arranged = [];
  // Pause renumbering so explicit move targets stay stable during the pass.
  tmux(["set-option", "-t", serverSession, "renumber-windows", "off"], { allowFailure: true });
  let slot = 101;
  for (const entry of desired) {
    const bindingFile = bindingFileFor(entry.windowName);
    if (!existsSync(bindingFile)) continue;
    const binding = readJson(bindingFile, "window-host binding");
    if (!windowAlive(binding)) continue;
    const tabName = tabNameFor(entry.role, entry.windowName);
    tmux(["rename-window", "-t", binding.tmux.windowId, tabName], { allowFailure: true });
    tmux(["move-window", "-s", binding.tmux.windowId, "-t", `${serverSession}:${slot}`], { allowFailure: true });
    binding.tmux.title = tabName;
    writeJson(bindingFile, binding);
    arranged.push({ window: entry.windowName, tab: tabName, slot: slot - 100 });
    slot += 1;
  }
  // Push unmanaged windows (bootstrap shells etc.) above the managed block so
  // the sequential renumber leaves them trailing in original relative order.
  const listed = tmux(["list-windows", "-t", serverSession, "-F", "#{window_index} #{window_id}"], { allowFailure: true });
  let trailSlot = 201;
  for (const line of (listed.stdout || "").trim().split("\n")) {
    const [index, windowId] = line.trim().split(" ");
    if (!windowId || Number(index) >= 101) continue;
    tmux(["move-window", "-s", windowId, "-t", `${serverSession}:${trailSlot}`], { allowFailure: true });
    trailSlot += 1;
  }
  tmux(["move-window", "-r", "-t", serverSession], { allowFailure: true });
  tmux(["set-option", "-t", serverSession, "renumber-windows", "on"], { allowFailure: true });
  return arranged;
}

const SEED_ALLOW_RULES = [
  "mcp__plugin_wakeflow_wakeflow",
  "Bash(node *)",
  "Bash(tmux *)",
  "Bash(git *)",
];

function readWorkspaceRepositories() {
  const configFile = path.join(workspaceRoot, "workspace.config.json");
  if (!existsSync(configFile)) return [];
  const config = readJson(configFile, "workspace config");
  return (Array.isArray(config.repositories) ? config.repositories : [])
    .filter((repo) => repo && repo.path)
    .map((repo) => path.resolve(workspaceRoot, repo.path))
    .filter((dir) => existsSync(dir));
}

function mergePermissionSettings(existing, { isWorkspaceRoot }) {
  const settings = existing && typeof existing === "object" ? existing : {};
  const permissions = settings.permissions && typeof settings.permissions === "object" ? settings.permissions : {};
  const allow = new Set(Array.isArray(permissions.allow) ? permissions.allow : []);
  for (const rule of SEED_ALLOW_RULES) allow.add(rule);
  const merged = { ...settings, permissions: { ...permissions, allow: [...allow].sort() } };
  if (!isWorkspaceRoot) {
    const dirs = new Set(Array.isArray(permissions.additionalDirectories) ? permissions.additionalDirectories : []);
    dirs.add(workspaceRoot);
    merged.permissions.additionalDirectories = [...dirs].sort();
  }
  return merged;
}

function commandSeedPermissions() {
  const write = hasFlag("--write");
  const targets = [workspaceRoot, ...readWorkspaceRepositories()];
  const seen = new Set();
  const results = [];
  for (const dir of targets) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const file = path.join(dir, ".claude", "settings.json");
    const existing = existsSync(file) ? readJson(file, "claude settings") : null;
    const merged = mergePermissionSettings(existing, { isWorkspaceRoot: dir === workspaceRoot });
    const changed = JSON.stringify(merged) !== JSON.stringify(existing);
    if (write && changed) writeJson(file, merged);
    results.push({
      settingsFile: path.relative(workspaceRoot, file) || ".claude/settings.json",
      existed: Boolean(existing),
      changed,
      wrote: write && changed,
    });
  }
  output({
    ok: true,
    command: "seed-permissions",
    wrote: write,
    allowRules: SEED_ALLOW_RULES,
    note: "Repo settings also gain permissions.additionalDirectories=[workspace root] so windows read parent workspace state without prompts. The workspace trust dialog still appears once per new directory; everything else becomes prompt-free under acceptEdits mode.",
    results,
  });
}

function commandHelp() {
  output({
    ok: true,
    commands: {
      preflight: "Report tmux/claude/brew availability and the install recommendation.",
      "ensure-server": "Create the wakeflow tmux server session when missing and start the activity monitor (--server wakeflow) [--no-monitor].",
      "activity-monitor": "Background poller that marks live-executing windows (>> running glyph) by watching pane state: [--server] [--poll-ms] [--once].",
      "launch-window": "Create one tmux-resident claude window: --window --cwd [--title] [--session-id] [--prompt-file] [--server] [--boot-wait-ms] [--claude-arg ...] [--replace] [--no-auto-trust]. Defaults to --permission-mode acceptEdits and auto-accepts the one-time folder trust dialog. Pass --resume with --session-id to restore a registered session into a fresh window after a reboot.",
      retitle: "Rename the tmux window that hosts a Wakeflow window: --window --title.",
      send: "Paste a prompt file into a window and record pane readback: --window --prompt-file [--delivery-id] [--lock-ttl-sec] [--force].",
      readback: "Capture the current pane tail for evidence: --window [--lines].",
      "release-lock": "Remove the shared in-flight delivery lock for a window: --window.",
      "wait-results": "Block until target results exist for a dispatch group: --group [--state-root <path>] [--target <window>...|--expect N] [--timeout-sec] [--poll-ms]. Scans both the delivery store and the state root target-results.",
      "attach-window": "Print the tmux attach/switch command for a window; --open-tab opens a new tab in the current terminal app (iTerm2 preferred) running attach. --window [--open-tab].",
      "launch-all": "Resume every registered window in canonical order (Design, controller, products, Test) using the recorded permissionMode, skipping in-flight windows: [--server <name>].",
      "set-unattended": "Set hosts.claude-code.permissionMode (acceptEdits|bypassPermissions|...) and report which live windows need a resume-restart: --mode <m> [--write].",
      "window-status": "Report per-window dispatch state (busy/done/stalled glyphs, lock, delivery id): [--reconcile] recomputes glyphs from the shared locks.",
      "check-workspace": "Read-only health check for an existing workspace: config hosts block, managed CLAUDE.md surfaces, registry/binding/liveness per window, permission seeds, legacy codex registry, plugin version stamp.",
      "stamp-runtime": "Record the converging plugin version in hosts/claude-code/runtime-meta.json: --write.",
      "arrange-windows": "Rename managed windows to short tabs and order them Design, controller, products, Test (unmanaged windows trail): [--server wakeflow].",
      "seed-permissions": "Merge wakeflow automation allowlists into .claude/settings.json at the workspace root and every configured repository: [--write] (dry-run by default).",
    },
  });
}

async function main() {
  switch (command) {
    case "preflight": return commandPreflight();
    case "ensure-server": return commandEnsureServer();
    case "activity-monitor": return commandActivityMonitor();
    case "launch-window": return commandLaunchWindow();
    case "retitle": return commandRetitle();
    case "send": return commandSend();
    case "readback": return commandReadback();
    case "release-lock": return commandReleaseLock();
    case "wait-results": return commandWaitResults();
    case "attach-window": return commandAttachWindow();
    case "seed-permissions": return commandSeedPermissions();
    case "arrange-windows": return commandArrangeWindows();
    case "check-workspace": return commandCheckWorkspace();
    case "window-status": return commandWindowStatus();
    case "set-unattended": return commandSetUnattended();
    case "launch-all": return commandLaunchAll();
    case "stamp-runtime": return commandStampRuntime();
    case "help": return commandHelp();
    default:
      fail(`Unknown command: ${command}`);
      return undefined;
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof CliExit) {
    console.error(JSON.stringify({ ok: false, command, error: error.message }, null, 2));
    process.exitCode = 1;
  } else {
    throw error;
  }
}
