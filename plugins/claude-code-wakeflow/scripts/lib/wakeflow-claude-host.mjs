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
 * - window bindings: .wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/<window>.json
 * - shared advisory locks: .wakeflow-local/wakeflow-delivery/locks/<window>.json
 * - shared results scanned by wait-results: .wakeflow-local/wakeflow-delivery/target-results/
 *
 * Environment overrides (used by tests): WAKEFLOW_TMUX_BIN, WAKEFLOW_CLAUDE_BIN.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import { withFileLock } from "./wakeflow-state-lock.mjs";
import {
  addStreamWorktree,
  appendPendingMergeRow,
  assertOverlayManageable,
  branchNameFor,
  trackedConfigFile,
  maxStreamsFor,
  overlayBaseStale,
  removeStreamWorktree,
  streamOpenRefusal,
  overlayConfigFile,
  overlayIsDerived,
  readOverlay,
  regenerateOverlay,
  streamEntries,
  streamEntryFor,
  streamWindowName,
  worktreeDirFor,
} from "./wakeflow-stream-overlay.mjs";

// This helper IS the Claude Code host transport boundary, so it runs the host
// binaries (tmux, claude, brew, osascript) directly with a narrow no-shell
// wrapper instead of lib/wakeflow-process.mjs, whose whitelist intentionally
// keeps host commands out of the shared core runtime scripts.
function execHostText(command, args, { env: envOverride = null } = {}) {
  const baseEnv = envOverride ?? process.env;
  const hasUtf8 = /utf-?8/i.test(baseEnv.LC_ALL || baseEnv.LANG || "");
  const env = hasUtf8 ? baseEnv : { ...baseEnv, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
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

// Resolve the true workspace root. The host helper is invoked from a target
// window's own cwd when that window sends a controller-return; without an explicit
// --root (or with --root pointing at a product/Design/Test subdir) process.cwd() is
// a sub-window subdir, not the workspace root, so binding/state lookups would hit a
// stray nested .wakeflow-local instead of the one real store and fail with
// "No window-host binding". Walk up to the nearest ancestor carrying
// wakeflow.config.json (the workspace-root marker; legacy workspace.config.json
// still counts) so every window's invocation
// anchors to the same store. Only sub-windows lack that file, so a correctly-passed
// --root (the workspace root) is returned unchanged.
function resolveWorkspaceRoot(start) {
  if (existsSync(path.join(start, "wakeflow.config.json")) || existsSync(path.join(start, "workspace.config.json"))) return start;
  let dir = start;
  for (let depth = 0; depth < 64; depth += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
    if (existsSync(path.join(dir, "wakeflow.config.json")) || existsSync(path.join(dir, "workspace.config.json"))) {
      process.stderr.write(
        `wakeflow-claude-host: resolved workspace root by walking up from ${start} to ${dir}; pass --root <workspace-root> to avoid this.\n`,
      );
      return dir;
    }
  }
  return start; // no wakeflow.config.json upward — keep the original (pre-init / standalone)
}

const workspaceRoot = resolveWorkspaceRoot(path.resolve(getValue("--root", process.cwd())));
const stateDir = path.resolve(getValue("--state-dir", path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery")));
const hostDir = path.join(stateDir, "hosts", HOST_DIR_NAME);
const windowHostDir = path.join(hostDir, "window-host");
const locksDir = path.join(stateDir, "locks");
const resultsDir = path.join(stateDir, "target-results");
const tmuxBin = process.env.WAKEFLOW_TMUX_BIN || "tmux";
const claudeBin = process.env.WAKEFLOW_CLAUDE_BIN || "claude";

// Optional dedicated tmux socket (opt-in). When hosts.claude-code.tmuxSocket is set
// in wakeflow.config.json (or --socket is passed) every tmux call runs against a
// private `tmux -L <socket>` server instead of the shared default socket, isolating
// the wakeflow fleet from the user's personal tmux sessions on the default server.
// Unset = default socket (backward-compatible). Resolved once; every tmux() call
// funnels the flag through, and the activity monitor inherits it via --root config.
// Window/topology reads prefer the DERIVED local overlay
// (.wakeflow-local/wakeflow.config.json, a regenerated full copy of the
// tracked config plus active stream entries) so stream windows resolve like
// ordinary windows. Writers (set-unattended) and durable-surface checks
// (check-workspace, seed-permissions) keep reading the tracked file directly.
function effectiveConfigFile() {
  const overlay = overlayConfigFile(workspaceRoot);
  return existsSync(overlay) ? overlay : trackedConfigFile(workspaceRoot);
}

// Preferred-config reads fail CLOSED on an existing-but-unparsable file: a
// silent fallback would run tmux against the wrong socket/session and treat
// the controller window as an ordinary lockable target (a lock with no
// release path). Absent file still yields defaults.
function readEffectiveConfig() {
  const configFile = effectiveConfigFile();
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, "utf8"));
  } catch (error) {
    fail(`unreadable workspace config ${configFile}: ${error.message}; fix or remove it before host operations.`);
  }
  return {};
}

function resolveTmuxSocket() {
  const override = getValue("--socket", null);
  if (override && override.trim()) return override.trim();
  const socket = readEffectiveConfig().hosts?.["claude-code"]?.tmuxSocket;
  return typeof socket === "string" && socket.trim() ? socket.trim() : null;
}
let tmuxSocket = null;
try {
  tmuxSocket = resolveTmuxSocket();
} catch (error) {
  console.error(JSON.stringify({ ok: false, command, error: error instanceof CliExit ? error.message : String(error?.message ?? error) }, null, 2));
  process.exit(1);
}
const tmuxSocketArgs = tmuxSocket ? ["-L", tmuxSocket] : [];

function defaultServerSession() {
  const session = readEffectiveConfig().hosts?.["claude-code"]?.tmuxSession;
  return typeof session === "string" && session.trim() ? session.trim() : "wakeflow";
}

let cachedControllerWindow;
function workspaceControllerWindow() {
  if (cachedControllerWindow !== undefined) return cachedControllerWindow;
  cachedControllerWindow = readEffectiveConfig().controllerWindow ?? null;
  return cachedControllerWindow;
}

function roleOfWindow(windowName) {
  const config = readEffectiveConfig();
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

function resolveModelArgs(windowName, hostConfig) {
  // hosts.claude-code.modelByRole pins the serving model per role so a window
  // restart cannot silently fall back to the settings default. No profile
  // default: without config the window inherits the user's normal model.
  const profileMap = hostProfile.launch.modelByRole ?? {};
  const configMap = hostConfig && typeof hostConfig.modelByRole === "object" ? hostConfig.modelByRole : {};
  const role = roleOfWindow(windowName);
  const model = configMap[role] ?? configMap.default ?? profileMap[role] ?? profileMap.default;
  return model ? ["--model", model] : [];
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
  // Atomic replace everywhere: bindings and (via set-unattended) the tracked
  // workspace config are files every resolver depends on; a crash mid-write
  // must never leave a torn JSON behind.
  const temp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} ${file}: ${error.message}`);
  }
  return null;
}

// tmux resolves `-t <name>` as exact match THEN unambiguous prefix — with pod
// sessions extending the main session name (wakeflow -> wakeflow-<pod>), a bare
// name can silently hit a sibling (kill the wrong pod, land fleet windows
// inside a pod). `=` forces exact matching everywhere a SESSION is targeted.
function sessionTarget(session) {
  return `=${session}`;
}

function tmux(tmuxArgs, { allowFailure = false, env = null } = {}) {
  const result = execHostText(tmuxBin, [...tmuxSocketArgs, ...tmuxArgs], { env });
  if (result.status !== 0 && !allowFailure) {
    fail(`tmux ${tmuxArgs.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

// The tmux SERVER captures the spawning process's environment and every window
// inherits it. When the fleet is (re)built from inside an agent session, that
// environment carries the agent's own session variables — empirically enough
// to break child `claude` auth ("Not logged in" across the whole fleet,
// H-15). Strip agent/SDK variables at server creation so fleet windows always
// see an environment shaped like the user's own terminal.
function sanitizedServerEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
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
  const result = tmux(["list-windows", "-t", sessionTarget(binding.tmux.session), "-F", "#{window_id}"], { allowFailure: true });
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
    ["set-option", "-t", sessionTarget(serverSession), "status-left", `[${serverSession}] `],
    ["set-option", "-t", sessionTarget(serverSession), "status-left-length", "14"],
    ["set-option", "-t", sessionTarget(serverSession), "status-right", ""],
    ["set-option", "-t", sessionTarget(serverSession), "status-right-length", "0"],
    ["set-option", "-t", sessionTarget(serverSession), "renumber-windows", "on"],
    ["set-option", "-t", sessionTarget(serverSession), "base-index", "1"],
    // refresh fast enough that the running marker tracks live execution
    ["set-option", "-t", sessionTarget(serverSession), "status-interval", "2"],
  ];
  for (const optionArgs of optionSets) tmux(optionArgs, { allowFailure: true });
  // migration: earlier versions set these as -g on the DEFAULT server, leaking
  // the wakeflow layout into the user's personal sessions; unset the globals.
  for (const option of ["window-status-format", "window-status-current-format", "window-status-separator"]) {
    tmux(["set-option", "-gu", option], { allowFailure: true });
  }
  // window-status-* are WINDOW options: apply them per managed window (never
  // -g) so the wakeflow glyph layout cannot leak into the user's personal tmux
  // sessions on the same default server.
  const listed = tmux(["list-windows", "-t", sessionTarget(serverSession), "-F", "#{window_id}"], { allowFailure: true });
  for (const wid of (listed.stdout || "").trim().split("\n").map((line) => line.trim()).filter(Boolean)) {
    applyWindowGlyphFormat(wid);
  }
}

function applyWindowGlyphFormat(windowId) {
  // Leading state glyph (the activity monitor sets @wakeflow_state): a solid
  // badge for a live-executing window, then the done marker. The glyph
  // sits OUTSIDE the current-window reverse styling so "who is running" is
  // visible regardless of which window is selected.
  const sets = [
    ["set-option", "-w", "-t", windowId, "window-status-format", `${STATE_GLYPH_FMT}#I:#{=14:window_name} `],
    ["set-option", "-w", "-t", windowId, "window-status-current-format", `${STATE_GLYPH_FMT}#[reverse]#[bold]#I:#{=16:window_name}#[noreverse] `],
    ["set-option", "-w", "-t", windowId, "window-status-separator", ""],
  ];
  for (const optionArgs of sets) tmux(optionArgs, { allowFailure: true });
}

const STATE_GLYPH_FMT = "#{?#{==:#{@wakeflow_state},running},#[bg=green]#[fg=black]#[bold] >> #[default],"
  + "#{?#{==:#{@wakeflow_state},done},#[fg=green]#[bold] +  #[default],    }}";

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
  } catch {
    return false;
  }
  // Guard against pid reuse after a reboot: the recorded pid must still be a
  // node process running THIS WORKSPACE's activity-monitor. Matching the bare
  // process name would let another workspace's monitor (pid-recycled) block
  // this one forever — the same wide-match mistake the cleanup rule forbids.
  const probe = execHostText("ps", ["-o", "command=", "-p", String(pid)]);
  return probe.status === 0
    && probe.stdout.includes("wakeflow-claude-host.mjs activity-monitor")
    && probe.stdout.includes(`--root ${workspaceRoot}`);
}

function startActivityMonitorDaemon(serverSession) {
  // One detached poller per server: it sets @wakeflow_state=running on windows
  // whose pane is mid-turn and clears it when idle. Single-instance via pidfile.
  // WAKEFLOW_DISABLE_MONITOR=1 suppresses the AUTO-start (tests and special
  // setups that run the monitor explicitly with their own flags).
  if (process.env.WAKEFLOW_DISABLE_MONITOR === "1") return false;
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
  const present = tmux(["has-session", "-t", sessionTarget(serverSession)], { allowFailure: true }).status === 0;
  if (!present) {
    // Sanitized env matters only on the call that BOOTS the server (the
    // server inherits it; sessions created later on a live server do not
    // re-capture the caller env).
    tmux(["new-session", "-d", "-s", serverSession, "-c", workspaceRoot], { env: sanitizedServerEnv() });
  }
  applyStatusOptions(serverSession);
  // Rearm the activity monitor on every server touch (launch-window/launch-all
  // included): after a reboot the documented restore path never runs the
  // ensure-server CLI command, and the pidfile keeps this idempotent.
  if (command !== "activity-monitor") startActivityMonitorDaemon(serverSession);
  return !present;
}

function commandEnsureServer() {
  const serverSession = getValue("--server", defaultServerSession());
  const created = ensureServer(serverSession);
  const monitorStarted = hasFlag("--no-monitor") ? false : startActivityMonitorDaemon(serverSession);
  output({ ok: true, command: "ensure-server", server: serverSession, created, activityMonitorStarted: monitorStarted });
}

function monitorWindowNames() {
  // windowId -> windowName from the live window-host bindings; shared delivery
  // locks and tab state are keyed by window NAME.
  const map = new Map();
  if (!existsSync(windowHostDir)) return map;
  for (const file of readdirSync(windowHostDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const binding = JSON.parse(readFileSync(path.join(windowHostDir, file), "utf8"));
      if (binding?.tmux?.windowId) map.set(binding.tmux.windowId, binding.windowName);
    } catch {
      // skip unreadable bindings
    }
  }
  return map;
}


async function commandActivityMonitor() {
  const serverSession = getValue("--server", defaultServerSession());
  const pollRaw = Number(getValue("--poll-ms", "1500"));
  const pollMs = Number.isFinite(pollRaw) ? Math.max(800, pollRaw) : 1500;
  const once = hasFlag("--once");
  const pidFile = activityMonitorPidFile(serverSession);
  if (!once) {
    if (activityMonitorRunning(serverSession)) {
      output({ ok: true, command: "activity-monitor", server: serverSession, started: false, note: "another monitor instance is already running" });
      return;
    }
    mkdirSync(path.dirname(pidFile), { recursive: true });
    try {
      // O_EXCL: two concurrent ensure-servers must not both pass the running
      // check and leave two pollers flapping the glyphs.
      writeFileSync(pidFile, String(process.pid), { flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (activityMonitorRunning(serverSession)) {
        output({ ok: true, command: "activity-monitor", server: serverSession, started: false, note: "another monitor instance won the pidfile race" });
        return;
      }
      rmSync(pidFile, { force: true });
      writeFileSync(pidFile, String(process.pid), { flag: "wx" });
    }
  }
  // Pure visibility, no judgment: the monitor lights the running badge while a
  // pane is active and flips a delivered window to done once its lock is
  // released by a recorded result. Whether a quiet window is stalled is the
  // CONTROLLER'S judgment (window-status / pane readback when it chooses to
  // look) — the monitor never marks stalls and never wakes anyone.
  // Robust activity detection: the "esc to interrupt" hint is NOT rendered in
  // every active-turn phase (long tool calls show only a spinner/elapsed
  // line), so any pane-content change between polls also counts as activity —
  // the elapsed timer alone changes every second while a turn runs. An idle
  // pane is byte-stable.
  const lastPane = new Map();
  const controllerWindowName = workspaceControllerWindow();
  let lastSummary = { running: [], completed: [] };
  for (;;) {
    if (tmux(["has-session", "-t", sessionTarget(serverSession)], { allowFailure: true }).status !== 0) break;
    const names = monitorWindowNames();
    const listed = tmux(["list-windows", "-t", sessionTarget(serverSession), "-F", "#{window_id}"], { allowFailure: true });
    const running = [];
    const completed = [];
    for (const wid of (listed.stdout || "").trim().split("\n").map((l) => l.trim()).filter(Boolean)) {
      const pane = tmux(["capture-pane", "-p", "-t", wid], { allowFailure: true }).stdout || "";
      const previousPane = lastPane.get(wid);
      lastPane.set(wid, pane);
      const isRunning = paneShowsExecution(pane) || (previousPane !== undefined && previousPane !== pane);
      const current = tmux(["show-options", "-w", "-q", "-v", "-t", wid, "@wakeflow_state"], { allowFailure: true }).stdout.trim();
      const windowName = names.get(wid);
      if (!windowName) continue;
      // The monitor owns the "running" overlay: it stashes the dispatch marker
      // (busy/done) in @wakeflow_prev_state while execution runs and restores
      // it when execution pauses.
      if (isRunning && current !== "running") {
        let stash = current;
        if (current === "stalled") {
          // residue from the removed stall feature: translate to the real
          // dispatch marker instead of parking it for restore
          stash = windowName && existsSync(lockFileFor(windowName)) ? "busy" : "";
        }
        if (stash) {
          tmux(["set-option", "-w", "-t", wid, "@wakeflow_prev_state", stash], { allowFailure: true });
        }
        tmux(["set-option", "-w", "-t", wid, "@wakeflow_state", "running"], { allowFailure: true });
      } else if (!isRunning && current === "running") {
        const previous = tmux(["show-options", "-w", "-q", "-v", "-t", wid, "@wakeflow_prev_state"], { allowFailure: true }).stdout.trim();
        if (previous) {
          tmux(["set-option", "-w", "-t", wid, "@wakeflow_state", previous], { allowFailure: true });
          tmux(["set-option", "-w", "-u", "-t", wid, "@wakeflow_prev_state"], { allowFailure: true });
        } else {
          tmux(["set-option", "-w", "-u", "-t", wid, "@wakeflow_state"], { allowFailure: true });
        }
      }
      if (isRunning) {
        running.push(wid);
        continue;
      }
      if (controllerWindowName && windowName === controllerWindowName) {
        // the controller has no delivery lifecycle: returns are notifications
        continue;
      }
      const effective = current === "running" ? "" : current;
      const lockPresent = existsSync(lockFileFor(windowName));
      if (effective === "busy" && !lockPresent) {
        // lock released by the core record/import path => the result landed
        tmux(["set-option", "-w", "-t", wid, "@wakeflow_state", "done"], { allowFailure: true });
        completed.push(windowName);
      } else if (effective === "stalled") {
        // migrate residue from the removed stall feature
        if (lockPresent) {
          tmux(["set-option", "-w", "-t", wid, "@wakeflow_state", "busy"], { allowFailure: true });
        } else {
          tmux(["set-option", "-w", "-u", "-t", wid, "@wakeflow_state"], { allowFailure: true });
        }
      }
    }
    lastSummary = { running, completed };
    if (once) break;
    await sleep(pollMs);
  }
  // delete the pidfile only when it still belongs to this instance
  if (!once && existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() === String(process.pid)) {
    rmSync(pidFile, { force: true });
  }
  output({ ok: true, command: "activity-monitor", server: serverSession, once, running: lastSummary.running, completed: lastSummary.completed });
}

function pastePromptFile(binding, promptFile) {
  const file = path.resolve(workspaceRoot, promptFile);
  if (!existsSync(file)) fail(`--prompt-file does not exist: ${promptFile}`);
  const bufferName = `wakeflow-${slug(binding.windowName)}-${Date.now()}`;
  tmux(["load-buffer", "-b", bufferName, file]);
  try {
    tmux(["paste-buffer", "-d", "-b", bufferName, "-t", binding.tmux.windowId]);
  } catch (error) {
    // paste-buffer -d only deletes on success; drop the orphan buffer
    tmux(["delete-buffer", "-b", bufferName], { allowFailure: true });
    throw error;
  }
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
  // wakeflow.config.json hosts.claude-code.claudeArgs; per-call --claude-arg
  // values still append after them and win on conflicts.
  const configFile = effectiveConfigFile();
  const hostConfig = existsSync(configFile) ? (readJson(configFile, "workspace config").hosts?.["claude-code"] ?? {}) : {};
  const configClaudeArgs = Array.isArray(hostConfig.claudeArgs) && hostConfig.claudeArgs.every((arg) => typeof arg === "string")
    ? hostConfig.claudeArgs
    : [];
  // Per-role reasoning effort: controller=max, workers=xhigh by default. Skip
  // when --effort is already supplied explicitly (per-call or global claudeArgs).
  const flagPresent = (argsList, name) => argsList.some((arg) => arg === name || arg.startsWith(`${name}=`));
  const effortAlreadySet = flagPresent(extraClaudeArgs, "--effort") || flagPresent(configClaudeArgs, "--effort");
  const effortArgs = effortAlreadySet ? [] : resolveEffortArgs(windowName, hostConfig);
  const modelAlreadySet = flagPresent(extraClaudeArgs, "--model") || flagPresent(configClaudeArgs, "--model");
  const modelArgs = modelAlreadySet ? [] : resolveModelArgs(windowName, hostConfig);
  // Permission mode precedence: explicit --claude-arg --permission-mode wins;
  // else wakeflow.config.json hosts.claude-code.permissionMode; else
  // acceptEdits so seeded allowlists keep the window prompt-free.
  // Default to acceptEdits (prompts before risky actions) as the SAFE shipped
  // default for distribution. A workspace opts into fully-unattended
  // bypassPermissions explicitly via /wakeflow:unattended or set-unattended;
  // that recorded choice is then the consent the boot dialog auto-confirms.
  const configMode = typeof hostConfig.permissionMode === "string" ? hostConfig.permissionMode : "acceptEdits";
  const modeExplicit = flagPresent(extraClaudeArgs, "--permission-mode") || flagPresent(configClaudeArgs, "--permission-mode");
  const modeArgs = modeExplicit ? [] : ["--permission-mode", configMode];
  const claudeCommand = [claudeBin, ...sessionArgs, "--add-dir", workspaceRoot, ...modeArgs, ...effortArgs, ...modelArgs, ...configClaudeArgs, ...extraClaudeArgs]
    .map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`)
    .join(" ");
  const created = tmux([
    "new-window",
    "-t", sessionTarget(serverSession),
    "-n", title,
    "-c", cwd,
    "-P", "-F", "#{window_id}",
    claudeCommand,
  ]);
  const windowId = created.stdout.trim();
  if (!windowId.startsWith("@")) fail(`tmux did not return a window id: ${created.stdout}`);
  tmux(["set-option", "-w", "-t", windowId, "automatic-rename", "off"], { allowFailure: true });
  applyWindowGlyphFormat(windowId);
  // A freshly launched/replaced window is idle — clear any inherited dispatch
  // glyph so it does not show a stale busy/done marker.
  tmux(["set-option", "-w", "-u", "-t", windowId, "@wakeflow_state"], { allowFailure: true });
  tmux(["set-option", "-w", "-u", "-t", windowId, "@wakeflow_prev_state"], { allowFailure: true });

  const binding = {
    kind: BINDING_KIND,
    version: 1,
    windowName,
    threadId: sessionId,
    cwd,
    tmux: { session: serverSession, windowId, title },
    createdAt: nowIso(),
  };
  writeJson(bindingFileFor(windowName), binding);

  await sleep(Number.isFinite(bootWaitMs) ? bootWaitMs : 6000);
  // Boot can present up to three sequential dialogs (folder trust -> bypass
  // consent -> large-session resume), and a slow resume can render a dialog a
  // frame after a clean-looking pane. Loop with a stability re-check so a late
  // dialog is not missed and the entry prompt never lands inside one.
  const dialogsConfirmed = [];
  if (!hasFlag("--no-auto-trust")) {
    // The folder-trust dialog is always covered by the user's window-launch
    // authorization (they mapped this directory as a managed window). The
    // bypass-permissions consent is auto-confirmed ONLY when the user opted
    // into bypass mode in wakeflow.config.json: that recorded choice IS the
    // prior consent. A bypass prompt without that opt-in is left for the user.
    const bypassConsented = configMode === "bypassPermissions";
    const dialogPatterns = [
      ["trust", /trust this folder|Do you trust/i, () => true],
      ["bypass-consent", /bypass permissions|skip all permission|dangerously/i, () => bypassConsented],
      ["resume", /Resume full session|Resume with summary/i, () => true],
    ];
    let quietChecks = 0;
    for (let attempt = 0; attempt < 8 && quietChecks < 2; attempt += 1) {
      const pane = capturePaneTail(binding, 30);
      const match = dialogPatterns.find(([, pattern, allowed]) => pattern.test(pane) && allowed());
      if (!match) {
        quietChecks += 1;
        await sleep(1200);
        continue;
      }
      quietChecks = 0;
      tmux(["send-keys", "-t", binding.tmux.windowId, "Enter"]);
      dialogsConfirmed.push(match[0]);
      await sleep(2800);
    }
  }
  const trustAccepted = dialogsConfirmed.length > 0;
  if (promptFile) {
    pastePromptFile(binding, promptFile);
  }

  output({
    ok: true,
    command: "launch-window",
    permissionMode: modeExplicit ? "explicit" : configMode,
    effort: effortArgs.length ? effortArgs[1] : (effortAlreadySet ? "explicit" : null),
    model: modelArgs.length ? modelArgs[1] : (modelAlreadySet ? "explicit" : null),
    role: roleOfWindow(windowName),
    trustAccepted,
    dialogsConfirmed,
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
  await performSend({ windowName, promptFile, deliveryId, commandName: "send" });
}

async function commandDeliver() {
  // One-step dispatch transport: read the delivery envelope from disk (the
  // compact prepare payload only carries its path), extract the prompt and
  // target, write the temp prompt file itself, send, and return compact
  // readback. Replaces the manual write-prompt-file + send ceremony.
  const deliveryFile = path.resolve(workspaceRoot, requireValue("--delivery-file"));
  if (!existsSync(deliveryFile)) fail(`--delivery-file does not exist: ${deliveryFile}`);
  const envelope = readJson(deliveryFile, "delivery envelope");
  const isControllerReturn = envelope.kind === "ControllerReturnEnvelope";
  const windowName = envelope.targetWindow || (isControllerReturn ? envelope.controllerWindow : null);
  if (!windowName) fail("delivery envelope names no target window.");
  if (!envelope.prompt) fail("delivery envelope has no prompt.");
  const promptFile = path.join(hostDir, `deliver-${slug(envelope.deliveryId || windowName)}.txt`);
  mkdirSync(path.dirname(promptFile), { recursive: true });
  writeFileSync(promptFile, envelope.prompt.endsWith("\n") ? envelope.prompt : `${envelope.prompt}\n`);
  try {
    await performSend({ windowName, promptFile, deliveryId: envelope.deliveryId || "", commandName: "deliver", controllerReturn: isControllerReturn });
  } finally {
    rmSync(promptFile, { force: true });
  }
}

async function performSend({ windowName, promptFile, deliveryId, commandName, controllerReturn = false }) {
  const lockTtlSec = Number(getValue("--lock-ttl-sec", "7200"));
  const binding = readBinding(windowName);
  if (!windowAlive(binding)) {
    fail(`tmux window for ${windowName} is not alive (${binding.tmux.windowId}); relaunch the same session interactively with launch-window --resume --session-id <registered id> --replace, then resend.`);
  }

  // A delivery to ANY controller window — the workspace controller or a pod's
  // Controller__<pod> (recognized by the ControllerReturnEnvelope it receives)
  // — is a return/notification: a controller never records a target-result for
  // itself, so a lock or busy marker written here would never be released and
  // would read as a stalled controller. Returns queue naturally in the input box.
  const isControllerTarget = controllerReturn || windowName === workspaceControllerWindow();
  // Lock semantics (aligned with core dispatch): a fresh lock from the OTHER
  // host means another controller is driving this window's working tree — fail
  // closed. A SAME-host lock is advisory: the core per-task sent-state guard
  // already prevents true double-dispatch.
  const lock = isControllerTarget ? null : readLock(windowName);
  let lockWarning;
  let effectiveDeliveryId = deliveryId;
  if (lock && lockIsFresh(lock)) {
    const otherHost = lock.host && lock.host !== HOST_DIR_NAME;
    const ownDelivery = Boolean(deliveryId) && lock.deliveryId === deliveryId;
    if (otherHost && !hasFlag("--force")) {
      fail(`Window ${windowName} has a fresh in-flight delivery lock from host ${lock.host} (${lock.deliveryId || "unknown delivery"}, expires ${lock.expiresAt}); wait for that delivery or pass --force.`);
    }
    if (!effectiveDeliveryId && !otherHost && lock.deliveryId) {
      effectiveDeliveryId = lock.deliveryId;
    }
    if (!ownDelivery) {
      // A lock for OUR delivery id was acquired at envelope-build time by the
      // core dispatch path; sending it is the expected next step, not a clash.
      lockWarning = otherHost
        ? `Proceeding over a fresh OTHER-HOST delivery lock on ${windowName} (host ${lock.host}, ${lock.deliveryId || "no delivery id"}) because --force was passed.`
        : `Proceeding over a fresh same-host delivery lock on ${windowName} (${lock.deliveryId || "no delivery id"}, created ${lock.createdAt}); the prior delivery's lock had no release path (e.g. a controller-return target).`;
    }
  }
  if (!isControllerTarget) {
    writeJson(lockFileFor(windowName), {
      kind: "WakeflowWindowDeliveryLock",
      version: 1,
      windowName,
      host: HOST_DIR_NAME,
      deliveryId: effectiveDeliveryId || undefined,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + (Number.isFinite(lockTtlSec) ? lockTtlSec : 7200) * 1000).toISOString(),
    });
  }

  // before/after MUST capture the same line count: a 5-line "before" against a
  // 25-line "after" differs by construction, making paneChanged always true and
  // the no-echo warning unreachable.
  const tailLines = Number(getValue("--lines", "25"));
  const captureLines = Number.isFinite(tailLines) ? tailLines : 25;
  const before = capturePaneTail(binding, captureLines);
  if (isControllerTarget) {
    // Multi-active demands mean concurrent controller-returns are normal. Two
    // simultaneous pastes can interleave at the tmux level (paste-A, paste-B,
    // Enter, Enter) and merge into one garbled message; serialize ONLY the
    // paste+Enter, PER controller window (pods each have their own). This is
    // NOT a delivery lock — a controller never goes busy, and returns still
    // queue naturally in its input box.
    try {
      withFileLock(path.join(hostDir, `paste-${slug(windowName)}.lock`), () => pastePromptFile(binding, promptFile));
    } catch (error) {
      if (error?.code === "WAKEFLOW_STATE_LOCK_TIMEOUT") fail(`controller paste mutex timed out (another return is mid-paste): ${error.message}`);
      throw error;
    }
  } else {
    pastePromptFile(binding, promptFile);
  }
  if (!isControllerTarget) setWindowState(windowName, "busy");
  const readbackWait = Number(getValue("--readback-wait-ms", "1200"));
  await sleep(Number.isFinite(readbackWait) ? readbackWait : 1200);
  const paneTail = capturePaneTail(binding, captureLines);
  // Cheap transport assertion: the prompt's first line should surface in the
  // pane. Claude Code may collapse large pastes, so a missing echo alone is
  // NOT an error — only a byte-stable pane AND no echo means "nothing visibly
  // happened" (paste landed in a dialog or a dead pane) and earns a warning.
  let promptFirstLine = "";
  try {
    promptFirstLine = readFileSync(path.resolve(workspaceRoot, promptFile), "utf8")
      .split("\n")
      .find((line) => line.trim()) || "";
  } catch {
    // prompt file already cleaned up by a concurrent teardown: the echo check
    // degrades to paneChanged-only rather than crashing an already-sent send
  }
  const promptEchoed = Boolean(promptFirstLine) && paneTail.includes(promptFirstLine.slice(0, 24));
  const paneChanged = paneTail !== before;
  const readbackWarning = !paneChanged && !promptEchoed
    ? "pane is byte-stable and the prompt's first line is not visible; the paste may have landed in a dialog or a dead pane — inspect the window before relying on this send"
    : undefined;

  output({
    ok: true,
    command: commandName,
    lockWarning,
    readbackWarning,
    windowName,
    windowId: binding.tmux.windowId,
    deliveryId: effectiveDeliveryId || undefined,
    sentAt: nowIso(),
    lockFile: isControllerTarget ? undefined : path.relative(workspaceRoot, lockFileFor(windowName)),
    controllerNotification: isControllerTarget || undefined,
    readback: {
      paneTail,
      paneChanged,
      promptEchoed,
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
  // (.wakeflow-local/wakeflow-delivery/target-results/) and the demand state
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
  const pollParsed = Number(getValue("--poll-ms", "2000"));
  const pollMs = Number.isFinite(pollParsed) ? Math.max(250, pollParsed) : 2000;
  const deadline = Date.now() + (Number.isFinite(timeoutSec) ? timeoutSec : 7200) * 1000;

  let found = [];
  for (;;) {
    const results = listGroupResults(group, stateRootDir);
    const windows = [...new Set(results.map((result) => result.targetWindow).filter(Boolean))];
    found = expectedWindows.length > 0 ? windows.filter((window) => expectedWindows.includes(window)) : windows;
    // Pure wait: lock release belongs to the core record/import path, and the
    // done glyph belongs to the activity monitor. This command only observes
    // and reports.
    const satisfied = expectedWindows.length > 0
      ? expectedWindows.every((window) => found.includes(window))
      : found.length >= expectCount;
    if (satisfied) {
      output({ ok: true, command: "wait-results", group, status: "ready", windows: found });
      return;
    }
    if (Date.now() >= deadline) {
      const missing = (expectedWindows.length > 0 ? expectedWindows : []).filter((window) => !found.includes(window));
      output({
        ok: false,
        command: "wait-results",
        group,
        status: "timeout",
        windows: found,
        missing,
        expected: expectedWindows.length > 0 ? expectedWindows : expectCount,
        note: "Timed out waiting for target results; whether the delivery is stalled is the controller's judgment (inspect window-status / the dispatch group).",
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
  // One reliable path: the user opens a new terminal window/tab themselves and
  // attaches. Programmatic tab-opening (osascript) proved unreliable across
  // terminals (tabs flash and close), so it is intentionally not offered.
  const attach = tmuxSocket
    ? `tmux -L ${tmuxSocket} attach -t ${binding.tmux.session}`
    : `tmux attach -t ${binding.tmux.session}`;
  output({
    ok: true,
    command: "attach-window",
    windowName,
    windowId: binding.tmux.windowId,
    session: binding.tmux.session,
    attach,
    instruction: `Open a new terminal window or tab, cd into this workspace, and run: ${attach}`,
  });
}


function readWorkspaceWindowModel() {
  // Fleet-wide operations (launch-all / replace-all / arrange) manage the
  // MAIN fleet only: read the tracked config, never the overlay — otherwise
  // pod isolation windows get resumed into the main session, breaking pod
  // isolation. Pods resume via pod-open.
  const configFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(configFile)) fail("wakeflow.config.json not found; run initialization first.");
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

const pluginRootDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

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

function relativeWorkspaceEntry(dir) {
  // Committed settings must stay portable: reference the parent workspace by a
  // RELATIVE path (".." for direct children), never the user's absolute path.
  const rel = path.relative(dir, workspaceRoot).split(path.sep).join("/");
  return rel || ".";
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
    if (!dirs.includes(relativeWorkspaceEntry(dir))) return "partial";
  }
  // committed settings must carry no machine-local residue
  if (settingsHasMachineResidue(parsed, dir)) return "partial";
  const localFile = path.join(dir, ".claude", "settings.local.json");
  if (!existsSync(localFile)) return "partial";
  try {
    const local = JSON.parse(readFileSync(localFile, "utf8"));
    if (!local.statusLine) return "partial";
  } catch {
    return "invalid";
  }
  // the statusline command points at a generated script in cleanable local
  // runtime: it must exist and match the current template, or every pane's
  // statusline silently errors while check reports healthy
  const script = statuslineScriptFile();
  if (!existsSync(script) || readFileSync(script, "utf8") !== STATUSLINE_SCRIPT) return "partial";
  return "seeded";
}

function settingsHasMachineResidue(parsed, dir) {
  const dirs = Array.isArray(parsed?.permissions?.additionalDirectories) ? parsed.permissions.additionalDirectories : [];
  if (dirs.includes(workspaceRoot)) return true;
  const command = parsed?.statusLine?.command;
  return typeof command === "string" && command.includes(".wakeflow-local/wakeflow-statusline.mjs");
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
      ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
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

async function commandReplaceAll() {
  // Robust, in-process "tear down + rebuild fresh" for the whole fleet (or a
  // named subset): for each window it kills the old tmux window and launches a
  // BRAND-NEW session (no --resume => fresh session id, empty context), then
  // registers the new id via the core setup replace-windows command (which
  // never touches workspace config/docs/scope). Replaces the fragile hand-
  // written launch + register loop; run from one call instead of a shell loop.
  const serverSession = getValue("--server", defaultServerSession());
  const onlyWindows = getAllValues("--window");
  const model = readWorkspaceWindowModel();
  const order = [model.design, model.controller, ...model.products, model.test]
    .filter(Boolean)
    .filter((windowName) => onlyWindows.length === 0 || onlyWindows.includes(windowName));
  if (order.length === 0) {
    fail(onlyWindows.length > 0
      ? `replace-all: none of ${onlyWindows.join(", ")} are configured windows.`
      : "replace-all found no configured windows; initialize the workspace first.");
  }
  ensureServer(serverSession);
  const setupScript = path.join(pluginRootDir, "scripts", "wakeflow-setup.mjs");
  const defaultStateDir = path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery");
  const bootWait = getValue("--boot-wait-ms", "7000");
  const results = [];
  for (const windowName of order) {
    const lock = readLock(windowName);
    if (lockIsFresh(lock)) {
      // a mid-flight window must not be torn down under an active delivery
      results.push({ window: windowName, status: "skipped-in-flight" });
      continue;
    }
    const repo = readRepositoryForWindow(windowName);
    // Entry-sync prompt: a freshly relaunched window otherwise boots as a generic claude with
    // no Wakeflow orientation. Paste a clear "who you are + read CLAUDE.md + wait for dispatch"
    // prompt after boot so the window orients itself instead of sitting clueless until the
    // first dispatch.
    const entrySyncFile = path.join(hostDir, `entry-sync-${slug(windowName)}.txt`);
    mkdirSync(hostDir, { recursive: true });
    writeFileSync(entrySyncFile, buildEntrySyncPrompt(windowName, repo));
    const launchArgv = [
      "launch-window", "--root", workspaceRoot, "--server", serverSession,
      ...(stateDir !== defaultStateDir ? ["--state-dir", stateDir] : []),
      "--window", windowName, "--title", repo.title, "--cwd", repo.cwd,
      "--prompt-file", entrySyncFile,
      "--replace", "--boot-wait-ms", bootWait,
    ];
    const launched = execHostText(process.execPath, [process.argv[1], ...launchArgv]);
    let launchParsed = null;
    try { launchParsed = JSON.parse(launched.stdout); } catch { /* keep raw */ }
    if (!launchParsed?.ok || !launchParsed.sessionId) {
      results.push({ window: windowName, status: "launch-failed", error: launchParsed?.error || (launched.stderr || launched.stdout).slice(-160) });
      continue;
    }
    const newSessionId = launchParsed.sessionId;
    const regArgv = [
      "replace-windows", "--root", workspaceRoot,
      "--window", windowName, "--thread", `${windowName}=${newSessionId}`,
      "--write", "--json",
    ];
    const registered = execHostText(process.execPath, [setupScript, ...regArgv]);
    let regParsed = null;
    try { regParsed = JSON.parse(registered.stdout); } catch { /* keep raw */ }
    results.push({
      window: windowName,
      status: regParsed?.ok ? "replaced" : "registration-failed",
      windowId: launchParsed.windowId,
      sessionIdRegistered: Boolean(regParsed?.ok),
      threadIdRedacted: true,
      error: regParsed?.ok ? undefined : (regParsed?.error || (registered.stderr || registered.stdout).slice(-160)),
    });
  }
  const arranged = arrangeWindows(serverSession);
  output({
    ok: results.every((x) => x.status === "replaced" || x.status === "skipped-in-flight"),
    command: "replace-all",
    server: serverSession,
    scope: onlyWindows.length > 0 ? onlyWindows : "all-configured",
    order,
    arranged,
    results,
  });
}

function buildEntrySyncPrompt(windowName, repo) {
  if (windowName === workspaceControllerWindow()) {
    // replace-all rebuilds the controller too: it must re-orient as the
    // CONTROLLER, not as a dispatch-waiting target.
    return `${[
      `You are the **${windowName}** window — the workspace CONTROLLER (working dir: ${repo.cwd}). This session was just rebuilt and has no conversational memory; the state roots are the memory.`,
      ``,
      `Entry sync — do this now:`,
      `1. Read \`CLAUDE.md\`, \`.wakeflow-active/index.md\`, and the current status doc, then the wakeflow-controller skill.`,
      `2. Run wakeflow_status and wakeflow_next_work to re-orient: active demands, capacity, in-flight deliveries, pending reviews.`,
      `3. Resume total-control judgment from DISK state only — review pending results, decide, dispatch next eligible work, or wait for returns. Do not re-create existing demands.`,
    ].join("\n")}\n`;
  }
  // Generic, host-neutral entry sync. The window's own CLAUDE.md (read in step 1) carries any
  // language preference, so this prompt stays English and points at the docs.
  const role = repo.title.replace(`${windowName} `, "") || "Work";
  return `${[
    `You are the **${windowName}** window in this multi-window Wakeflow workspace (working dir: ${repo.cwd}; role: ${role}). The window was just (re)launched and has no task yet.`,
    ``,
    `Entry sync — do this before any dispatch arrives:`,
    `1. Read the parent workspace \`CLAUDE.md\` (the controller's rules) and this repository's own \`CLAUDE.md\`/\`AGENTS.md\`, and follow them (including any language preference they set).`,
    `2. State your window name and repository identity in one line.`,
    `3. You are a Wakeflow TARGET window: execute only the task packages the controller dispatches to you, return a TargetResultEnvelope when done, and never self-start, claim another window's work, or touch another repository.`,
    `4. Storage layout: controller state lives under \`.wakeflow-active/\` (no nested \`workspace/\` layer); transport lives under \`.wakeflow-local/\`; real session ids stay only in \`.wakeflow-local/\`.`,
    `5. Confirm you are ready, then WAIT for a controller dispatch — do not begin work before a task package arrives.`,
  ].join("\n")}\n`;
}

function readRepositoryForWindow(windowName) {
  const config = readJson(effectiveConfigFile(), "workspace config");
  // Titles are ASCII by design: CJK names were repeatedly mangled by shell
  // locale hops between the controller agent, tmux, and display surfaces.
  if (windowName === config.controllerWindow) {
    return { cwd: workspaceRoot, title: `${windowName} Controller` };
  }
  const repo = (Array.isArray(config.repositories) ? config.repositories : []).find((r) => r.windowName === windowName);
  if (!repo) {
    fail(`window ${windowName} is registered but not in wakeflow.config.json repositories; fix the config (or register the window under its configured name) before launching it.`);
  }
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
  const configFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(configFile)) fail("wakeflow.config.json not found; run initialization first.");
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
  // The derived stream overlay is a full COPY of the tracked config; a tracked
  // write would leave it stale until the next stream operation, so regenerate
  // it in the same turn (H-8).
  let overlayRegenerated = false;
  let overlayWarning;
  if (write) {
    try {
      withStreamMutationLock(() => {
        const overlay = readOverlay(workspaceRoot);
        if (overlay && overlayIsDerived(overlay)) {
          regenerateOverlay(workspaceRoot, streamEntries(overlay));
          overlayRegenerated = true;
        }
      });
    } catch (error) {
      overlayWarning = `stream overlay was not regenerated: ${error.message}`;
    }
  }
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
    overlayRegenerated,
    overlayWarning,
    previousMode: previous,
    mode,
    note: mode === "bypassPermissions"
      ? "Unattended mode: work windows run with no permission prompts. They stay bounded by repository worktrees, CLAUDE.md gates, and the Wakeflow state machine. Resume-restart live windows to apply; in-flight windows must finish first."
      : "Windows resume-restart into this mode; bypass auto-consent no longer applies.",
    restart,
  });
}

function activityMonitorOwnership(serverSession) {
  // Ownership visibility: one monitor per workspace+server. Cleanup must match
  // by --root (visible in the process command line), never by bare process
  // name — a wide pgrep kills OTHER workspaces' monitors.
  const pidFile = activityMonitorPidFile(serverSession);
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : null;
  return {
    server: serverSession,
    root: workspaceRoot,
    running: activityMonitorRunning(serverSession),
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    cleanupRule: "match monitor processes by --root, never by bare process name",
  };
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
        // busy follows the shared lock; transient done or legacy stale markers clear here
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
  output({
    ok: true,
    command: "window-status",
    reconciled: reconcile,
    activityMonitor: activityMonitorOwnership(getValue("--server", defaultServerSession())),
    windows: rows,
  });
}

function commandCheckWorkspace() {
  const gaps = [];
  const note = (area, status, fix, extra = {}) => gaps.push({ area, status, fix, ...extra });

  const tmuxPresent = execHostText(tmuxBin, ["-V"]).status === 0;
  if (!tmuxPresent) note("binaries", "tmux-missing", "brew install tmux (retry once on a transient bottle error)");

  const configFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(configFile)) {
    note("workspace-config", "missing", "Run /wakeflow:init for first-time initialization; check-workspace targets existing environments.");
    output({ ok: true, command: "check-workspace", pluginVersion: pluginVersion(), stamp: null, gaps });
    return;
  }
  if (path.basename(configFile) === "workspace.config.json") {
    note("workspace-config", "legacy-name", "Rename workspace.config.json to wakeflow.config.json (git mv; reads keep working on the legacy name, but the canonical name makes it clearly Wakeflow's config).");
  }
  const config = readJson(configFile, "workspace config");
  if (!config.hosts || typeof config.hosts !== "object" || !config.hosts["claude-code"]) {
    note("workspace-config", "hosts-block-missing", "Add hosts.claude-code (e.g. { \"tmuxSession\": \"wakeflow\" }) to wakeflow.config.json.");
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
      note("repository", "directory-missing", "Confirm the repository path in wakeflow.config.json.", { window: repo.windowName });
      continue;
    }
    if (repo.managedAgents !== false) {
      const cardState = memoryFileState(dir);
      if (cardState !== "managed") {
        note("window-card", cardState, "wakeflow_initialize_workspace apply:true upserts the managed CLAUDE.md access card.", { window: repo.windowName });
      }
    }
    const seeded = settingsSeeded(dir, { isWorkspaceRoot: dir === workspaceRoot });
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

  try {
    const overlay = readOverlay(workspaceRoot);
    if (overlay && !overlayIsDerived(overlay)) {
      note("stream-overlay", "user-owned", "Informational: the local config override under .wakeflow-local/ is hand-maintained; stream registration stays disabled until it is folded into wakeflow.config.json.");
    } else if (overlay && overlayBaseStale(workspaceRoot, overlay)) {
      note("stream-overlay", "stale-base", "the tracked wakeflow config changed after the stream overlay was generated; any stream-open/stream-close regenerates it (or close all streams to drop it).");
    }
  } catch (error) {
    note("stream-overlay", "unreadable", error.message);
  }

  // Storage hygiene (reminders, never gates): unknown trees under
  // .wakeflow-local, legacy residue from older runtimes, missing in-place
  // READMEs, and preserved/ entries past retention. wakeflow_view
  // scope=storage is the full map; nothing here auto-deletes anything.
  try {
    const storage = JSON.parse(execHostText(process.execPath, [
      path.join(pluginRootDir, "scripts", "wakeflow-storage.mjs"),
      "map", "--root", workspaceRoot, "--json",
    ]).stdout);
    for (const tree of storage.unknown ?? []) {
      note("storage", "unknown-tree", `Unrecognized tree ${tree.path} (${tree.files} files): route to the user — fold keepers with 'wakeflow-storage preserve', never auto-delete.`);
    }
    for (const tree of storage.legacy ?? []) {
      note("storage", "legacy-residue", `${tree.path} (${tree.files} files; ${tree.origin}): current runtime never writes this — after user review, fold via 'wakeflow-storage preserve' or delete.`);
    }
    for (const name of storage.preservedAging ?? []) {
      note("storage", "preserved-aging", `preserved/${name} is past the ${storage.preservedRetentionDays}-day retention: review its MANIFEST.md, then 'wakeflow_prune_runtime target=preserved' or keep with an updated manifest.`);
    }
    const readmes = JSON.parse(execHostText(process.execPath, [
      path.join(pluginRootDir, "scripts", "wakeflow-storage.mjs"),
      "seed-readmes", "--root", workspaceRoot, "--json",
    ]).stdout);
    const staleReadmes = (readmes.results ?? []).filter((r) => r.status === "would-create" || r.status === "would-update");
    if (staleReadmes.length > 0) {
      note("storage", "readmes-stale", `${staleReadmes.length} in-place storage README(s) missing/stale: run 'wakeflow-storage seed-readmes --write'.`);
    }
  } catch {
    // storage map is best-effort orientation; never fail the health check on it
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
    activityMonitor: activityMonitorOwnership(defaultServerSession()),
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
  // Pause renumbering so explicit move targets stay stable during the pass;
  // the finally below guarantees it is restored even when a move fails.
  tmux(["set-option", "-t", sessionTarget(serverSession), "renumber-windows", "off"], { allowFailure: true });
  try {
  let slot = 101;
  for (const entry of desired) {
    const bindingFile = bindingFileFor(entry.windowName);
    if (!existsSync(bindingFile)) continue;
    const binding = readJson(bindingFile, "window-host binding");
    if (!windowAlive(binding)) continue;
    const tabName = tabNameFor(entry.role, entry.windowName);
    tmux(["rename-window", "-t", binding.tmux.windowId, tabName], { allowFailure: true });
    tmux(["move-window", "-s", binding.tmux.windowId, "-t", `${sessionTarget(serverSession)}:${slot}`], { allowFailure: true });
    binding.tmux.title = tabName;
    writeJson(bindingFile, binding);
    arranged.push({ window: entry.windowName, tab: tabName, slot: slot - 100 });
    slot += 1;
  }
  // Push unmanaged windows (bootstrap shells etc.) above the managed block so
  // the sequential renumber leaves them trailing in original relative order.
  const listed = tmux(["list-windows", "-t", sessionTarget(serverSession), "-F", "#{window_index} #{window_id}"], { allowFailure: true });
  let trailSlot = 201;
  for (const line of (listed.stdout || "").trim().split("\n")) {
    const [index, windowId] = line.trim().split(" ");
    if (!windowId || Number(index) >= 101) continue;
    tmux(["move-window", "-s", windowId, "-t", `${sessionTarget(serverSession)}:${trailSlot}`], { allowFailure: true });
    trailSlot += 1;
  }
    tmux(["move-window", "-r", "-t", sessionTarget(serverSession)], { allowFailure: true });
  } finally {
    tmux(["set-option", "-t", sessionTarget(serverSession), "renumber-windows", "on"], { allowFailure: true });
  }
  return arranged;
}

// Always-visible model indicator for fleet windows. The statusline command
// receives Claude Code's render JSON on stdin; the script prints the ACTUAL
// serving model and flags a mismatch against the workspace's configured
// modelByRole pin, so a silent model switch is immediately visible in-pane.
const STATUSLINE_SCRIPT = `#!/usr/bin/env node
// Generated by wakeflow (seed-permissions). Shows the live serving model and
// the WINDOW identity, nothing else. Identity comes from the registered
// session id (immune to cd drift inside the session); cwd is only a fallback
// for unregistered sessions.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = process.env.WAKEFLOW_STATE_DIR || path.join(root, ".wakeflow-local/wakeflow-delivery");
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { /* render with what we have */ }
  const model = input.model ?? {};
  const cwd = input.workspace?.project_dir || input.workspace?.current_dir || process.cwd();
  const sessionId = input.session_id || "";
  let windowName = null;
  try {
    const registry = path.join(stateDir, "hosts/claude-code/thread-registry");
    for (const file of readdirSync(registry)) {
      if (!file.endsWith(".json")) continue;
      const record = JSON.parse(readFileSync(path.join(registry, file), "utf8"));
      if (record.threadId === sessionId) { windowName = record.windowName; break; }
    }
  } catch { /* no registry: fall back to cwd */ }
  let label = windowName || path.basename(cwd);
  try {
    const config = JSON.parse(readFileSync(trackedConfigFile(root), "utf8"));
    if (windowName && windowName === config.controllerWindow) label = "Controller";
  } catch { /* keep label */ }
  const name = model.display_name || model.id || "model?";
  console.log(\`\${name} \u00b7 \${label}\`);
});
`;

function statuslineScriptFile() {
  return path.join(workspaceRoot, ".wakeflow-local", "wakeflow-statusline.mjs");
}

function ensureStatuslineScript(write) {
  const file = statuslineScriptFile();
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  const changed = current !== STATUSLINE_SCRIPT;
  if (write && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, STATUSLINE_SCRIPT);
  }
  return { file, changed };
}

const SEED_ALLOW_RULES = [
  "mcp__plugin_wakeflow_wakeflow",
  "Bash(node *)",
  "Bash(tmux *)",
  "Bash(git *)",
];

function readWorkspaceRepositories() {
  const configFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(configFile)) return [];
  const config = readJson(configFile, "workspace config");
  return (Array.isArray(config.repositories) ? config.repositories : [])
    .filter((repo) => repo && repo.path)
    .map((repo) => path.resolve(workspaceRoot, repo.path))
    .filter((dir) => existsSync(dir));
}

function mergePermissionSettings(existing, { isWorkspaceRoot, dir }) {
  // COMMITTED settings: portable content only (allow rules + RELATIVE parent
  // reference). Machine-local items (statusLine -> .wakeflow-local script,
  // absolute paths) belong in .claude/settings.local.json. Never mutate
  // `existing`: the caller detects changes by comparing against it.
  const settings = existing && typeof existing === "object" ? { ...existing } : {};
  const permissions = settings.permissions && typeof settings.permissions === "object" ? settings.permissions : {};
  const allow = new Set(Array.isArray(permissions.allow) ? permissions.allow : []);
  for (const rule of SEED_ALLOW_RULES) allow.add(rule);
  const merged = { ...settings, permissions: { ...permissions, allow: [...allow].sort() } };
  if (!isWorkspaceRoot) {
    const dirs = new Set(Array.isArray(permissions.additionalDirectories) ? permissions.additionalDirectories : []);
    // migrate: drop the absolute workspace path earlier wakeflow versions wrote
    dirs.delete(workspaceRoot);
    dirs.add(relativeWorkspaceEntry(dir));
    merged.permissions.additionalDirectories = [...dirs].sort();
  } else if (Array.isArray(permissions.additionalDirectories) && permissions.additionalDirectories.includes(workspaceRoot)) {
    // root-level absolute residue: clean it here too, or check-workspace flags
    // a "partial" that seeding can never converge
    merged.permissions.additionalDirectories = permissions.additionalDirectories.filter((entry) => entry !== workspaceRoot);
  }
  // migrate: move the wakeflow statusline out of the committed file (a custom
  // user statusLine is left untouched)
  if (typeof merged.statusLine?.command === "string" && merged.statusLine.command.includes(".wakeflow-local/wakeflow-statusline.mjs")) {
    delete merged.statusLine;
  }
  return merged;
}

function mergeLocalSettings(existing) {
  // MACHINE-LOCAL settings (.claude/settings.local.json, never committed):
  // the statusline command may carry this machine's absolute script path.
  const settings = existing && typeof existing === "object" ? { ...existing } : {};
  if (!settings.statusLine) {
    settings.statusLine = { type: "command", command: `node "${statuslineScriptFile()}"` };
  }
  return settings;
}

function commandSeedPermissions() {
  const write = hasFlag("--write");
  const statuslineScript = ensureStatuslineScript(write);
  const targets = [workspaceRoot, ...readWorkspaceRepositories()];
  const seen = new Set();
  const results = [];
  for (const dir of targets) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const file = path.join(dir, ".claude", "settings.json");
    let existing = null;
    if (existsSync(file)) {
      try {
        existing = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // an unparsable settings file must not abort the whole seed run: skip
        // this target with a report so the user can repair it by hand
        results.push({ settingsFile: path.relative(workspaceRoot, file), existed: true, invalid: true, changed: false, wrote: false });
        continue;
      }
    }
    const merged = mergePermissionSettings(existing, { isWorkspaceRoot: dir === workspaceRoot, dir });
    const changed = JSON.stringify(merged) !== JSON.stringify(existing);
    if (write && changed) writeJson(file, merged);
    const localFile = path.join(dir, ".claude", "settings.local.json");
    const existingLocal = existsSync(localFile) ? readJson(localFile, "claude local settings") : null;
    const mergedLocal = mergeLocalSettings(existingLocal);
    const localChanged = JSON.stringify(mergedLocal) !== JSON.stringify(existingLocal);
    if (write && localChanged) writeJson(localFile, mergedLocal);
    results.push({
      settingsFile: path.relative(workspaceRoot, file) || ".claude/settings.json",
      existed: Boolean(existing),
      changed,
      wrote: write && changed,
      localSettingsFile: path.relative(workspaceRoot, localFile) || ".claude/settings.local.json",
      localChanged,
      localWrote: write && localChanged,
    });
  }
  output({
    ok: true,
    command: "seed-permissions",
    wrote: write && (results.some((entry) => entry.wrote || entry.localWrote) || statuslineScript.changed),
    statuslineScript: {
      file: path.relative(workspaceRoot, statuslineScript.file),
      changed: statuslineScript.changed,
      wrote: write && statuslineScript.changed,
    },
    allowRules: SEED_ALLOW_RULES,
    note: "Committed repo settings gain portable entries only (allow rules + a RELATIVE additionalDirectories parent reference); machine-local items such as the wakeflow statusline live in .claude/settings.local.json, which is never committed. Past absolute-path/statusLine residue in settings.json is migrated out automatically.",
    results,
  });
}

const DEFAULT_MAX_STREAMS = 2;

// ONE mutation lock for every overlay read-modify-write (open, close,
// set-unattended regen). A per-repo lock is NOT enough: two opens for
// DIFFERENT repos still race the shared overlay file and the second write
// silently drops the first's entry.
function streamMutationLockFile() {
  return path.join(hostDir, "stream-overlay.lock");
}

function withStreamMutationLock(fn) {
  mkdirSync(hostDir, { recursive: true });
  try {
    return withFileLock(streamMutationLockFile(), fn);
  } catch (error) {
    if (error?.code === "WAKEFLOW_STATE_LOCK_TIMEOUT") fail(error.message);
    throw error;
  }
}

function buildStreamEntrySyncPrompt(windowName, repoWindow, worktreeRel, branch, demandKey) {
  return `${[
    `You are the **${windowName}** window — an ISOLATION worktree window of the ${repoWindow} repository in this Wakeflow workspace (worktree: ${worktreeRel}; branch: ${branch}; demand: ${demandKey}). You are demand ${demandKey}'s ONE window for this repository.`,
    ``,
    `Entry sync — do this before any dispatch arrives:`,
    `1. Read the parent workspace \`CLAUDE.md\` (the controller's rules) and this repository's own \`CLAUDE.md\`/\`AGENTS.md\`, and follow them.`,
    `2. State your window name and worktree identity in one line.`,
    `3. You are a Wakeflow TARGET window: execute only the task packages the controller dispatches to you, return a TargetResultEnvelope when done, and never self-start or claim another window's work.`,
    `4. ISOLATION BOUNDARY: work ONLY inside this worktree on branch ${branch}. Never touch the repository's main checkout, another demand's worktree, or other branches; merging back to the main line is a controller-owned step, never yours.`,
    `5. Confirm you are ready, then WAIT for a controller dispatch — do not begin work before a task package arrives.`,
  ].join("\n")}\n`;
}

// stream-open: one CROSS-DEMAND isolation window = one ordinary window
// `<repo>__<id>` bound to a fresh git worktree on branch `<demandKey>/<id>`.
// Within a demand each repo runs exactly ONE window; this exists so a LATER
// active demand touching an occupied repo gets its own checkout. All new
// state is the derived config overlay; locks/registry/launch reuse the
// windowName-keyed machinery unchanged. The pool cap bounds concurrent
// demands per repo: exhaustion blocks, it never widens.
function commandStreamOpen() {
  const repoWindow = requireValue("--repo");
  const streamId = slug(requireValue("--stream"));
  const demandKey = requireValue("--demand-key");
  const baseBranch = getValue("--base", "");
  const noLaunch = hasFlag("--no-launch");

  const trackedFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(trackedFile)) fail("wakeflow.config.json not found; run initialization first.");
  try {
    assertOverlayManageable(workspaceRoot);
  } catch (error) {
    fail(error.message);
  }
  const baseConfig = readJson(trackedFile, "workspace config");
  const repoEntry = (Array.isArray(baseConfig.repositories) ? baseConfig.repositories : [])
    .find((repo) => repo.windowName === repoWindow);
  if (!repoEntry) fail(`--repo ${repoWindow} is not a configured repository window.`);
  const repoPath = path.resolve(workspaceRoot, repoEntry.path);
  if (!existsSync(repoPath)) fail(`repository path does not exist: ${repoPath}`);
  // Streams belong to a live demand: refuse a provably closed one (its
  // worktrees would orphan behind the archive gate). A missing default state
  // root only warns — custom-located roots are legitimate.
  const demandStateFile = path.join(workspaceRoot, ".wakeflow-active", "current", slug(demandKey), "wakeflow-state.json");
  if (existsSync(demandStateFile)) {
    try {
      const demandState = JSON.parse(readFileSync(demandStateFile, "utf8")).state;
      if (demandState === "completed" || demandState === "archived") {
        fail(`demand ${demandKey} is ${demandState}; streams attach to open demands only.`);
      }
    } catch (error) {
      if (error instanceof CliExit) throw error;
      // unreadable state root: leave it to wakeflow-verify, do not block here
    }
  } else {
    process.stderr.write(`wakeflow-claude-host: no state root found for demand ${demandKey} at the default location; proceeding (custom state-root locations are not resolvable from the host helper).\n`);
  }
  const windowName = streamWindowName(repoWindow, streamId);
  const branch = branchNameFor(demandKey, streamId);
  const worktreeDir = worktreeDirFor(workspaceRoot, repoWindow, streamId);
  const worktreeRel = path.relative(workspaceRoot, worktreeDir).split(path.sep).join("/");
  mkdirSync(hostDir, { recursive: true });
  mkdirSync(path.dirname(worktreeDir), { recursive: true });

  // Idempotent resume: an already-registered isolation window is not an error.
  // --no-launch reports it; a live window reports it; a registered-but-dead
  // window (e.g. a pod prepared with --no-launch, or after a reboot) skips the
  // worktree/overlay work and goes straight to launch+register below.
  let resumeExisting = false;
  {
    const overlayNow = readOverlay(workspaceRoot);
    const existingEntry = overlayNow ? streamEntryFor(overlayNow, windowName) : null;
    if (existingEntry) {
      if (existingEntry.stream?.demandKey !== demandKey) {
        fail(`isolation window ${windowName} is already registered for demand ${existingEntry.stream?.demandKey}; pick another --stream id.`);
      }
      const bindingFile = bindingFileFor(windowName);
      let alive = false;
      if (existsSync(bindingFile)) {
        try {
          alive = windowAlive(JSON.parse(readFileSync(bindingFile, "utf8")));
        } catch {
          alive = false;
        }
      }
      if (noLaunch || alive) {
        output({
          ok: true,
          command: "stream-open",
          windowName,
          repo: repoWindow,
          streamId,
          demandKey,
          branch: existingEntry.stream?.branch ?? branch,
          worktree: existingEntry.path,
          resumed: false,
          status: alive ? "already-live" : "already-registered",
          launched: alive,
          sessionRegistered: alive,
          threadIdRedacted: true,
          note: alive
            ? "Isolation window is already live; nothing to do."
            : "Isolation window is registered but not launched (--no-launch); re-run without --no-launch to launch it.",
        });
        return;
      }
      resumeExisting = true;
    }
  }

  // Registration + worktree creation are one critical section under the
  // GLOBAL overlay mutation lock: pool count, git refs, and the shared overlay
  // regeneration must not race any other stream operation (same repo or not).
  // Launch (slow) happens after release. A resume skips this entirely — its
  // worktree and overlay entry already exist.
  let poolExhausted = null;
  let activeForRepo = [];
  let cap = DEFAULT_MAX_STREAMS;
  if (!resumeExisting) withStreamMutationLock(() => {
    const overlay = readOverlay(workspaceRoot);
    if (overlay && overlayBaseStale(workspaceRoot, overlay)) {
      process.stderr.write("wakeflow-claude-host: stream overlay was stale against the tracked wakeflow config; regenerating from the current base.\n");
    }
    const existing = overlay ? streamEntries(overlay) : [];
    cap = maxStreamsFor(baseConfig, repoEntry, DEFAULT_MAX_STREAMS);
    activeForRepo = existing.filter((entry) => entry.stream?.repo === repoWindow).map((entry) => entry.windowName);
    // Open rules (one window per (repo, demand), pool cap, collisions) are the
    // shared core contract — identical for every edition by construction.
    const refusal = streamOpenRefusal({
      baseConfig, streams: existing, repoWindow, repoEntry, windowName, demandKey, fallbackCap: DEFAULT_MAX_STREAMS,
    });
    if (refusal?.code === "pool-exhausted") {
      poolExhausted = { activeStreams: refusal.activeStreams, maxStreams: refusal.maxStreams };
      return;
    }
    if (refusal) fail(refusal.message);
    try {
      addStreamWorktree({
        workspaceRoot, repoEntry, repoWindow, streamId, demandKey, branch, baseBranch,
        streams: existing, exec: execHostText,
      });
    } catch (error) {
      if (error instanceof CliExit) throw error;
      fail(error.message);
    }
    activeForRepo = [...activeForRepo, windowName];
  });
  if (poolExhausted) {
    output({
      ok: false,
      command: "stream-open",
      code: "pool-exhausted",
      repo: repoWindow,
      requestedStream: streamId,
      ...poolExhausted,
      note: "Stream pool for this repository is exhausted; wait for an active stream to be closed after acceptance, then retry (or sequence the work). Never widen maxStreams just to unblock unattended work.",
    });
    process.exitCode = 1;
    return;
  }

  let launch = null;
  let registration = null;
  if (!noLaunch) {
    const entrySyncFile = path.join(hostDir, `entry-sync-${slug(windowName)}.txt`);
    writeFileSync(entrySyncFile, buildStreamEntrySyncPrompt(windowName, repoWindow, worktreeRel, branch, demandKey));
    const launchArgv = [
      "launch-window", "--root", workspaceRoot, "--server", getValue("--server", defaultServerSession()),
      ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
      "--window", windowName, "--title", windowName, "--cwd", worktreeDir,
      "--prompt-file", entrySyncFile, "--boot-wait-ms", getValue("--boot-wait-ms", "7000"),
    ];
    const launched = execHostText(process.execPath, [process.argv[1], ...launchArgv]);
    try {
      launch = JSON.parse(launched.stdout);
    } catch {
      launch = null;
    }
    if (!launch?.ok || !launch.sessionId) {
      fail(`stream window launch failed (worktree + overlay are in place; retry with launch-window or stream-close ${windowName}): ${launch?.error || (launched.stderr || launched.stdout).slice(-200)}`);
    }
    const setupScript = path.join(pluginRootDir, "scripts", "wakeflow-setup.mjs");
    const registered = execHostText(process.execPath, [
      setupScript, "replace-windows", "--root", workspaceRoot,
      "--window", windowName, "--thread", `${windowName}=${launch.sessionId}`, "--write", "--json",
    ]);
    try {
      registration = JSON.parse(registered.stdout);
    } catch {
      registration = null;
    }
    if (!registration?.ok) {
      fail(`stream window session registration failed: ${registration?.error || (registered.stderr || registered.stdout).slice(-200)}`);
    }
  }

  output({
    ok: true,
    command: "stream-open",
    windowName,
    repo: repoWindow,
    streamId,
    demandKey,
    branch,
    worktree: worktreeRel,
    overlay: path.relative(workspaceRoot, overlayConfigFile(workspaceRoot)),
    activeStreamsForRepo: activeForRepo,
    maxStreams: cap,
    launched: Boolean(launch),
    sessionRegistered: Boolean(registration?.ok),
    threadIdRedacted: true,
    note: noLaunch
      ? "Worktree, branch, and registration overlay are in place (--no-launch); launch later with launch-window --window <name> --cwd <worktree>."
      : "Stream window is live. Dispatch to it by windowName like any other window; one stream carries one task at a time.",
  });
}

// stream-close: teardown is explicit and evidence-respecting — a dirty
// worktree or an unmerged branch refuses by default so accepted-but-unmerged
// work cannot be deleted casually.
function commandStreamClose() {
  const windowName = requireValue("--window");
  const force = hasFlag("--force");
  const deleteBranch = hasFlag("--delete-branch");
  withStreamMutationLock(() => streamCloseLocked({ windowName, force, deleteBranch }));
}

function streamCloseLocked({ windowName, force, deleteBranch }) {
  let overlay;
  try {
    overlay = assertOverlayManageable(workspaceRoot);
  } catch (error) {
    fail(error.message);
  }
  const entry = overlay ? streamEntryFor(overlay, windowName) : null;
  if (!entry) fail(`${windowName} is not a registered stream window (no stream entry in the local config overlay).`);
  const branch = entry.stream.branch;
  // In-flight guard (same rule as launch-all/replace-all): a fresh delivery
  // lock means a dispatched task has not landed its result yet; killing the
  // window now would wedge the group-ready wave forever.
  const deliveryLock = readLock(windowName);
  if (lockIsFresh(deliveryLock) && !force) {
    fail(`stream ${windowName} has a fresh in-flight delivery lock (${deliveryLock.deliveryId || "unknown delivery"}, expires ${deliveryLock.expiresAt}); wait for its result or pass --force to tear it down anyway.`);
  }

  // Worktree/branch teardown gates are the shared core contract (dirty and
  // unreadable trees refuse, -d guards unmerged branches) — identical for
  // every edition by construction. Host-side teardown stays below.
  let steps = [];
  try {
    steps = removeStreamWorktree({ workspaceRoot, entry, force, deleteBranch, exec: execHostText }).steps;
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fail(error.message);
  }

  const bindingFile = bindingFileFor(windowName);
  if (existsSync(bindingFile)) {
    try {
      const binding = readJson(bindingFile, "window-host binding");
      if (windowAlive(binding)) tmux(["kill-window", "-t", binding.tmux.windowId], { allowFailure: true });
    } catch {
      // unreadable binding: still remove the file below
    }
    rmSync(bindingFile, { force: true });
    steps.push("tmux-window-closed");
  }
  for (const runtimeFile of [
    path.join(hostDir, "thread-registry", `${slug(windowName)}.json`),
    path.join(hostDir, "window-config", `${slug(windowName)}.json`),
    lockFileFor(windowName),
  ]) {
    if (existsSync(runtimeFile)) {
      rmSync(runtimeFile, { force: true });
      steps.push(path.basename(path.dirname(runtimeFile)));
    }
  }

  // Decentralized merging: nothing in Wakeflow merges pod branches, so the
  // only defense against forgotten branches is a durable ledger row appended
  // the moment a branch outlives its window.
  let pendingMergeLedger;
  if (!deleteBranch) {
    pendingMergeLedger = appendPendingMergeRow({
      workspaceRoot,
      ledgerRoot: readEffectiveConfig().projectLedgerRoot ?? "../wakeflow-ledger",
      demandKey: entry.stream.demandKey,
      repo: entry.stream.repo,
      branch,
      windowName,
      now: nowIso,
    });
  }

  const remaining = streamEntries(overlay).filter((item) => item.windowName !== windowName);
  let overlayInfo;
  try {
    overlayInfo = regenerateOverlay(workspaceRoot, remaining);
  } catch (error) {
    fail(`isolation window torn down, but the overlay could not be regenerated (${error.message}); re-run stream-close --window ${windowName} after fixing it.`);
  }
  rmSync(path.join(hostDir, `entry-sync-${slug(windowName)}.txt`), { force: true });
  output({
    ok: true,
    command: "stream-close",
    pendingMergeLedger,
    windowName,
    repo: entry.stream.repo,
    branch,
    branchDeleted: deleteBranch,
    steps,
    overlayRemoved: overlayInfo.removed,
    remainingStreams: remaining.map((item) => item.windowName),
  });
}

// stream-list: three-way reconcile (overlay registration / worktree on disk /
// tmux liveness) — pure observation, no repair side effects.
function commandStreamList() {
  let overlay = null;
  try {
    overlay = readOverlay(workspaceRoot);
  } catch (error) {
    fail(error.message);
  }
  if (overlay && !overlayIsDerived(overlay)) {
    output({ ok: true, command: "stream-list", overlay: "user-owned", streams: [], note: "local config overlay is hand-maintained; stream registration is disabled for this workspace." });
    return;
  }
  const rows = (overlay ? streamEntries(overlay) : []).map((entry) => {
    const worktreePresent = existsSync(path.resolve(workspaceRoot, entry.path));
    const bindingFile = bindingFileFor(entry.windowName);
    let alive = false;
    if (existsSync(bindingFile)) {
      try {
        alive = windowAlive(JSON.parse(readFileSync(bindingFile, "utf8")));
      } catch {
        alive = false;
      }
    }
    const registered = existsSync(path.join(hostDir, "thread-registry", `${slug(entry.windowName)}.json`));
    const lock = readLock(entry.windowName);
    const status = !worktreePresent
      ? "broken-missing-worktree"
      : alive
        ? "active"
        : registered
          ? "resumable"
          : "prepared";
    return {
      window: entry.windowName,
      repo: entry.stream?.repo,
      demandKey: entry.stream?.demandKey,
      branch: entry.stream?.branch,
      worktree: entry.path,
      worktreePresent,
      registered,
      tmuxAlive: alive,
      lockFresh: lockIsFresh(lock),
      status,
    };
  });
  output({
    ok: true,
    command: "stream-list",
    overlay: overlay ? path.relative(workspaceRoot, overlayConfigFile(workspaceRoot)) : null,
    overlayStale: overlay ? overlayBaseStale(workspaceRoot, overlay) : false,
    streams: rows,
  });
}

// ---------------------------------------------------------------------------
// Demand pods: one demand = one pod (its OWN controller + per-repo isolation
// worktree windows + its OWN Test) in its OWN tmux session, mutually unaware
// of other pods. Branch merge-back is fully decentralized (human-reviewed,
// outside Wakeflow); the pending-merges ledger is the memory that survives it.

function podSessionFor(podSlug) {
  return `${defaultServerSession()}-${podSlug}`;
}

function podBindingWindows(podSlug) {
  return [`Controller__${podSlug}`, `Test__${podSlug}`];
}

function buildPodControllerPrompt(demandKey, podSlug, repos) {
  const podWindows = repos.map((repo) => `${repo}__${podSlug}`).join(", ");
  return `${[
    `You are **Controller__${podSlug}** — the DEDICATED controller of demand ${demandKey}, running in your own pod session. You know nothing about other demands or pods; never read or touch their state roots, windows, or branches.`,
    ``,
    `Pod start — do this now:`,
    `1. Read the parent workspace \`CLAUDE.md\` and the wakeflow-controller skill (the S0→S6 route applies unchanged inside the pod).`,
    `2. Claim YOUR demand: wakeflow_create_demand with todoId "${demandKey}" and controllerWindow "Controller__${podSlug}" — todoId consumes the TODO row (demandKey defaults to it) and the stamped controllerWindow routes every controller-return back to YOU. If the state root ALREADY exists (pod resume after a restart), do NOT re-create: read it, run wakeflow_adopt_demand_host if needed, and continue the loop from its current state.`,
    `3. Your fleet: dispatch ONLY to ${podWindows || "your pod windows"} (isolation worktrees) and Test__${podSlug}. One combined task package per repo; author objectives; evidence-based review.`,
    `4. The WHOLE pod shares this demand's ONE worktree set: every window — Test included — works and verifies inside those worktrees, and nothing in this pod touches a repository's main checkout or another demand's worktrees.`,
    `5. Merge-back of pod branches is HUMAN-reviewed after archive — never merge yourself. Close order at the end: complete-demand -> stream-close each repo window -> archive -> report; the user runs pod-close.`,
  ].join("\n")}\n`;
}

// The pod Test window has no repositories[] entry of its own, so without an
// entry prompt it would default to "verify against the main checkouts" — the
// exact opposite of the pod contract. The prompt binds it to the demand's
// worktree set (the pod-wide shared working trees).
function buildPodTestPrompt(demandKey, podSlug, repos) {
  const worktrees = repos.map((repo) => {
    const rel = path.relative(workspaceRoot, worktreeDirFor(workspaceRoot, repo, podSlug)).split(path.sep).join("/");
    return `${repo} -> ${rel} (branch ${branchNameFor(demandKey, podSlug)})`;
  });
  return `${[
    `You are **Test__${podSlug}** — the DEDICATED Test window of demand ${demandKey}, running in its pod session. You know nothing about other demands or pods; never read or touch their state roots, windows, worktrees, or branches.`,
    ``,
    `Pod Test ground rules:`,
    `1. Read the parent workspace \`CLAUDE.md\` and the wakeflow-target skill, then state your window identity in one line.`,
    `2. This demand's code lives ONLY in its isolation worktrees${worktrees.length ? `: ${worktrees.join("; ")}` : ""}. Run every verification against those worktrees — never against a repository's main checkout.`,
    `3. Execute only test cards delivered by Controller__${podSlug} and report a TargetResultEnvelope with evidence refs. You never fix product code, choose environments the card does not name, or dispatch other windows.`,
  ].join("\n")}\n`;
}

// pod-open: idempotent orchestration of existing machinery — pod session +
// per-repo isolation windows (stream-open) + pod controller + pod Test.
// Re-running resumes a partially opened pod instead of failing it.
function commandPodOpen() {
  const demandKey = requireValue("--demand-key");
  const podSlug = slug(demandKey);
  const repos = (requireValue("--repos") || "").split(",").map((name) => name.trim()).filter(Boolean);
  if (repos.length === 0) fail("--repos needs at least one configured repository window name.");
  const noLaunch = hasFlag("--no-launch");
  const bootWait = getValue("--boot-wait-ms", "7000");
  const trackedFile = trackedConfigFile(workspaceRoot);
  if (!existsSync(trackedFile)) fail("wakeflow.config.json not found; run initialization first.");
  const baseConfig = readJson(trackedFile, "workspace config");
  const baseRepos = Array.isArray(baseConfig.repositories) ? baseConfig.repositories : [];
  for (const repo of repos) {
    if (!baseRepos.some((entry) => entry.windowName === repo)) fail(`--repos names ${repo}, which is not a configured repository window.`);
  }

  // Preflight: the pod controller will CLAIM this demand — warn early when the
  // board does not know it yet, and refuse a provably closed one.
  const currentDir = readEffectiveConfig().workspaceCurrentDir ?? ".wakeflow-active/current";
  const stateFile = path.resolve(workspaceRoot, currentDir, podSlug, "wakeflow-state.json");
  if (existsSync(stateFile)) {
    try {
      const demandState = JSON.parse(readFileSync(stateFile, "utf8")).state;
      if (demandState === "completed" || demandState === "archived") {
        fail(`demand ${demandKey} is ${demandState}; a pod attaches to a claimable or open demand.`);
      }
      process.stderr.write(`wakeflow-claude-host: demand ${demandKey} already has a state root (${demandState}); the pod controller should RESUME it, not re-create it.\n`);
    } catch (error) {
      if (error instanceof CliExit) throw error;
    }
  } else {
    const boardPath = path.resolve(workspaceRoot, readEffectiveConfig().globalTodoPath ?? path.join(currentDir, "global-todo-board.md"));
    if (!existsSync(boardPath) || !readFileSync(boardPath, "utf8").includes(demandKey)) {
      process.stderr.write(`wakeflow-claude-host: ${demandKey} is not on the global TODO board yet; make sure Design delivered it before the pod controller tries to claim.\n`);
    }
  }

  // Cross-pod repo intersection: independent demands sharing a repo are the
  // top source of merge conflicts — say it now, not at merge time.
  let overlay = readOverlay(workspaceRoot);
  const intersections = (overlay ? streamEntries(overlay) : [])
    .filter((entry) => entry.stream?.demandKey !== demandKey && repos.includes(entry.stream?.repo))
    .map((entry) => ({ repo: entry.stream.repo, occupiedBy: entry.stream.demandKey, window: entry.windowName }));

  const podSession = podSessionFor(podSlug);
  const windows = [];
  for (const repo of repos) {
    const windowName = streamWindowName(repo, podSlug);
    // stream-open is idempotent-resume: fresh -> full open, registered+dead ->
    // launch+register only, registered+live or --no-launch -> report and skip.
    const argv = [
      "stream-open", "--root", workspaceRoot, "--repo", repo, "--stream", podSlug,
      "--demand-key", demandKey, "--server", podSession, "--boot-wait-ms", bootWait,
      ...(noLaunch ? ["--no-launch"] : []),
      ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
    ];
    const opened = execHostText(process.execPath, [process.argv[1], ...argv]);
    let parsed = null;
    try {
      parsed = JSON.parse(opened.stdout);
    } catch {
      parsed = null;
    }
    if (!parsed?.ok) {
      fail(`pod-open stopped at ${windowName} (already-opened pod windows are kept; fix the cause and re-run pod-open to resume): ${parsed?.error || parsed?.code || (opened.stderr || opened.stdout).slice(-200)}`);
    }
    windows.push({ window: windowName, status: parsed.status ?? "opened", branch: parsed.branch });
  }

  const controllerWindow = `Controller__${podSlug}`;
  const testWindow = `Test__${podSlug}`;
  let controllerLaunched = false;
  let testLaunched = false;
  // Entry prompts are written even under --no-launch: they are deterministic
  // transient artifacts of pod PREPARATION, and a later manual launch (or a
  // pod-open re-run) sends them as-is.
  const promptFile = path.join(hostDir, `pod-entry-${podSlug}.txt`);
  const testPromptFile = path.join(hostDir, `pod-entry-${podSlug}-test.txt`);
  mkdirSync(hostDir, { recursive: true });
  writeFileSync(promptFile, buildPodControllerPrompt(demandKey, podSlug, repos));
  writeFileSync(testPromptFile, buildPodTestPrompt(demandKey, podSlug, repos));
  if (!noLaunch) {
    for (const [windowName, cwd, prompt] of [
      [controllerWindow, workspaceRoot, promptFile],
      [testWindow, path.resolve(workspaceRoot, baseConfig.internalTestPath ?? "Test"), testPromptFile],
    ]) {
      if (!existsSync(cwd)) {
        process.stderr.write(`wakeflow-claude-host: cwd for ${windowName} does not exist (${cwd}); skipped.\n`);
        continue;
      }
      const bindingFile = bindingFileFor(windowName);
      if (existsSync(bindingFile)) {
        try {
          if (windowAlive(readJson(bindingFile, "window-host binding"))) {
            windows.push({ window: windowName, status: "already-live" });
            continue;
          }
        } catch {
          // unreadable binding: relaunch below
        }
      }
      // Resume a registered session (reboot / pod-open re-run) instead of
      // replacing it with a contextless fresh one whose prompt says "claim".
      const registryFile = path.join(hostDir, "thread-registry", `${slug(windowName)}.json`);
      let registeredSessionId = null;
      if (existsSync(registryFile)) {
        try {
          registeredSessionId = JSON.parse(readFileSync(registryFile, "utf8")).threadId ?? null;
        } catch {
          registeredSessionId = null;
        }
      }
      const argv = [
        "launch-window", "--root", workspaceRoot, "--server", podSession,
        "--window", windowName, "--title", windowName, "--cwd", cwd,
        ...(registeredSessionId
          ? ["--resume", "--session-id", registeredSessionId]
          : prompt ? ["--prompt-file", prompt] : []),
        "--replace", "--boot-wait-ms", bootWait,
        ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
      ];
      const launched = execHostText(process.execPath, [process.argv[1], ...argv]);
      let parsed = null;
      try {
        parsed = JSON.parse(launched.stdout);
      } catch {
        parsed = null;
      }
      if (!parsed?.ok) {
        fail(`pod-open stopped launching ${windowName} (re-run pod-open to resume): ${parsed?.error || (launched.stderr || launched.stdout).slice(-200)}`);
      }
      if (!registeredSessionId && parsed.sessionId) {
        // First launch: persist the session id so the pod survives reboots
        // (register-thread accepts pod-SHAPED windows — Controller__<pod> and
        // configured-base__<pod> — since W-pod-2; the binding alone cannot
        // resume a dead session).
        const registered = execHostText(process.execPath, [
          path.join(pluginRootDir, "scripts", "wakeflow-delivery.mjs"),
          "register-thread", "--root", workspaceRoot,
          "--window", windowName, "--thread-id", parsed.sessionId, "--write", "--json",
          ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
        ]);
        let regParsed = null;
        try {
          regParsed = JSON.parse(registered.stdout);
        } catch {
          regParsed = null;
        }
        if (!regParsed?.ok) {
          process.stderr.write(`wakeflow-claude-host: session registration failed for ${windowName}; the pod will not survive a reboot until re-opened (${(registered.stderr || registered.stdout).slice(-160)}).\n`);
        }
      }
      if (windowName === controllerWindow) controllerLaunched = true;
      else testLaunched = true;
      windows.push({ window: windowName, status: registeredSessionId ? "resumed" : "launched" });
    }
  }

  output({
    ok: true,
    command: "pod-open",
    pod: podSlug,
    demandKey,
    session: podSession,
    windows,
    controllerWindow,
    testWindow,
    controllerLaunched,
    testLaunched,
    intersections,
    costNote: `each pod window is a full live claude session (${windows.length} for this pod); maxActiveDemands bounds pods, maxStreamsPerRepo bounds pods per repo`,
    attach: `${tmuxBin}${tmuxSocket ? ` -L ${tmuxSocket}` : ""} attach -t ${podSession}`,
    agentNext: noLaunch
      ? "Pod worktrees and registrations are in place (--no-launch); launch later by re-running pod-open without --no-launch."
      : `Pod is live and autonomous: Controller__${podSlug} claims ${demandKey} and runs the standard loop. Merge-back stays human-reviewed; run pod-close after the demand archives.`,
  });
}

// pod-close: sweep AFTER the demand archived (close order: complete ->
// stream-close repos -> archive -> pod-close). Leftover isolation windows are
// closed here (their branches land on the pending-merges ledger), then the
// pod's controller/Test windows and session go away.
function commandPodClose() {
  const demandKey = requireValue("--demand-key");
  const podSlug = slug(demandKey);
  const force = hasFlag("--force");
  const currentDir = readEffectiveConfig().workspaceCurrentDir ?? ".wakeflow-active/current";
  const stateFile = path.resolve(workspaceRoot, currentDir, podSlug, "wakeflow-state.json");
  if (existsSync(stateFile) && !force) {
    let demandState = "unreadable";
    try {
      demandState = JSON.parse(readFileSync(stateFile, "utf8")).state;
    } catch {
      // unreadable counts as not-archived
    }
    if (demandState !== "archived") {
      fail(`demand ${demandKey} is ${demandState}, not archived. Close order: complete-demand -> stream-close each repo window -> archive -> pod-close (pass --force to tear the pod down anyway).`);
    }
  }

  const overlay = readOverlay(workspaceRoot);
  const leftovers = (overlay ? streamEntries(overlay) : []).filter((entry) => entry.stream?.demandKey === demandKey);
  const closed = [];
  for (const entry of leftovers) {
    const argv = [
      "stream-close", "--root", workspaceRoot, "--window", entry.windowName,
      ...(force ? ["--force"] : []),
      ...(stateDir !== path.resolve(workspaceRoot, ".wakeflow-local/wakeflow-delivery") ? ["--state-dir", stateDir] : []),
    ];
    const result = execHostText(process.execPath, [process.argv[1], ...argv]);
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    if (!parsed?.ok) fail(`pod-close stopped at ${entry.windowName}: ${parsed?.error || (result.stderr || result.stdout).slice(-200)}`);
    closed.push({ window: entry.windowName, branch: entry.stream.branch, pendingMergeLedger: parsed.pendingMergeLedger });
  }

  const swept = [];
  for (const windowName of podBindingWindows(podSlug)) {
    const bindingFile = bindingFileFor(windowName);
    if (!existsSync(bindingFile)) continue;
    try {
      const binding = readJson(bindingFile, "window-host binding");
      if (windowAlive(binding)) tmux(["kill-window", "-t", binding.tmux.windowId], { allowFailure: true });
    } catch {
      // unreadable binding: still remove
    }
    rmSync(bindingFile, { force: true });
    rmSync(path.join(hostDir, "thread-registry", `${slug(windowName)}.json`), { force: true });
    rmSync(path.join(hostDir, "window-config", `${slug(windowName)}.json`), { force: true });
    rmSync(lockFileFor(windowName), { force: true });
    rmSync(path.join(hostDir, `paste-${slug(windowName)}.lock`), { force: true });
    swept.push(windowName);
  }
  const podSession = podSessionFor(podSlug);
  tmux(["kill-session", "-t", sessionTarget(podSession)], { allowFailure: true });
  rmSync(path.join(hostDir, `pod-entry-${podSlug}.txt`), { force: true });

  output({
    ok: true,
    command: "pod-close",
    pod: podSlug,
    demandKey,
    closedIsolationWindows: closed,
    sweptWindows: swept,
    sessionKilled: podSession,
    agentNext: closed.length > 0
      ? "Pod is closed. Review wakeflow-ledger/workspace/pending-merges.md and merge or drop the listed branches (human-reviewed, outside Wakeflow)."
      : "Pod is closed; its branches were already recorded on the pending-merges ledger at stream-close time.",
  });
}

// pod-list: the ONE read-only global view a mutually-unaware pod model needs —
// which pods exist, whether their sessions live, and their demand states.
function commandPodList() {
  let overlay = null;
  try {
    overlay = readOverlay(workspaceRoot);
  } catch (error) {
    fail(error.message);
  }
  const byDemand = new Map();
  for (const entry of (overlay ? streamEntries(overlay) : [])) {
    const key = entry.stream?.demandKey ?? "unknown";
    if (!byDemand.has(key)) byDemand.set(key, []);
    byDemand.get(key).push(entry.windowName);
  }
  // pods that opened controller/Test but whose repos are already closed
  if (existsSync(windowHostDir)) {
    for (const file of readdirSync(windowHostDir)) {
      const match = /^controller__(.+)\.json$/i.exec(file);
      if (match && ![...byDemand.keys()].some((key) => slug(key) === match[1])) byDemand.set(match[1], []);
    }
  }
  const pods = [...byDemand.entries()].map(([demandKey, windows]) => {
    const podSlug = slug(demandKey);
    const stateFile = path.resolve(workspaceRoot, readEffectiveConfig().workspaceCurrentDir ?? ".wakeflow-active/current", podSlug, "wakeflow-state.json");
    let demandState = "no-state-root";
    if (existsSync(stateFile)) {
      try {
        demandState = JSON.parse(readFileSync(stateFile, "utf8")).state;
      } catch {
        demandState = "unreadable";
      }
    }
    const session = podSessionFor(podSlug);
    const sessionAlive = tmux(["has-session", "-t", sessionTarget(session)], { allowFailure: true }).status === 0;
    return { demandKey, pod: podSlug, session, sessionAlive, demandState, isolationWindows: windows };
  });
  output({ ok: true, command: "pod-list", pods });
}

function commandHelp() {
  output({
    ok: true,
    command: "help",
    commands: {
      preflight: "Report tmux/claude/brew availability and the install recommendation.",
      "ensure-server": "Create the wakeflow tmux server session when missing and start the activity monitor (--server wakeflow) [--no-monitor].",
      "activity-monitor": "Background visibility poller: lights the running badge while a pane is active (hint or content change) and flips delivered windows to done when their lock is released by a recorded result. It never marks stalls and never wakes anyone - silence judgment belongs to the controller. Started automatically by ensure-server/launches: [--server] [--poll-ms] [--once].",
      "launch-window": "Create one tmux-resident claude window: --window --cwd [--title] [--session-id] [--prompt-file] [--server] [--boot-wait-ms] [--claude-arg ...] [--replace] [--no-auto-trust]. Defaults to --permission-mode acceptEdits and auto-accepts the one-time folder trust dialog. Pass --resume with --session-id to restore a registered session into a fresh window after a reboot.",
      retitle: "Rename the tmux window that hosts a Wakeflow window: --window --title.",
      send: "Paste a prompt file into a window and record pane readback: --window --prompt-file [--delivery-id] [--lock-ttl-sec] [--force].",
      "deliver": "One-step dispatch transport: read the delivery envelope file, write the prompt to a temp file, send it into the registered tmux window, and return compact readback evidence: --delivery-file <envelope.json> [--readback-wait-ms] [--lines] [--force]. Replaces the manual prompt-file + send ceremony.",
      readback: "Capture the current pane tail for evidence: --window [--lines].",
      "release-lock": "Remove the shared in-flight delivery lock for a window: --window.",
      "wait-results": "Explicit synchronous wait for target results of one dispatch group (scans both result layers; pure observation, no lock or glyph side effects). NOT a default dispatch step: the controller-return delivery is the wake-up. A timeout is a report, not a verdict - whether the delivery is stalled is the controller judgment: --group <id> [--target <w>...] [--expect n] [--timeout-sec] [--poll-ms] [--state-root <path>].",
      "attach-window": "Print the human instruction to enter the workspace (open a new terminal window/tab and run tmux attach -t <session>): --window.",
      "launch-all": "Resume every registered window in canonical order (Design, controller, products, Test) using the recorded permissionMode, skipping in-flight windows: [--server <name>].",
      "replace-all": "Tear down and rebuild the whole fleet (or a named subset) with BRAND-NEW sessions: kills each old tmux window, launches a fresh claude session (empty context), and registers the new id via core replace-windows (config/docs untouched). Skips in-flight windows: [--server <name>] [--window <name> ...] [--boot-wait-ms].",
      "set-unattended": "Set hosts.claude-code.permissionMode (acceptEdits|bypassPermissions|...), regenerate the derived stream overlay when present (a tracked-config write must not leave it stale), and report which live windows need a resume-restart: --mode <m> [--write].",
      "window-status": "Report per-window dispatch state (busy/done, lock, delivery id) plus activity-monitor ownership (pid/root/server — clean up monitors by --root, never by bare process name): [--reconcile] recomputes busy from shared locks and clears stale visual markers.",
      "check-workspace": "Read-only health check for an existing workspace: config hosts block, managed CLAUDE.md surfaces, registry/binding/liveness per window, permission seeds, legacy codex registry, plugin version stamp.",
      "stamp-runtime": "Record the converging plugin version in hosts/claude-code/runtime-meta.json: --write.",
      "arrange-windows": "Rename managed windows to short tabs and order them Design, controller, products, Test (unmanaged windows trail): [--server wakeflow].",
      "seed-permissions": "Converge both settings layers for the workspace root and every configured repository: portable allow rules + relative parent reference into committed .claude/settings.json, the machine-local statusline into .claude/settings.local.json, plus the generated statusline script. Migrates older absolute-path/statusLine residue. [--write] (dry-run by default).",
      "stream-open": "Open one CROSS-DEMAND isolation window: git worktree on branch <demand-key>/<id> + a registered window <repo>__<id> in the derived local config overlay, then launch + register its claude session: --repo <window> --stream <id> --demand-key <key> [--base <branch>] [--no-launch] [--server] [--boot-wait-ms]. Refuses a second window for the same (repo, demand) — within a demand each repo runs ONE window with a combined task package. Blocks with pool-exhausted at maxStreams (bounds concurrent demands per repo, default 2).",
      "stream-close": "Close one stream: refuse a dirty worktree without --force, git worktree remove, optional --delete-branch (-d refuses unmerged; --force upgrades to -D), kill the tmux window, drop registry/binding/lock, regenerate (or remove) the overlay: --window <repo>__<stream> [--delete-branch] [--force].",
      "stream-list": "Three-way stream reconcile (overlay registration / worktree / tmux liveness) with per-stream status (active|resumable|prepared|broken) and overlay base-hash staleness. Read-only.",
      "pod-open": "Open a demand pod: its OWN tmux session with Controller__<pod> + per-repo isolation worktree windows + Test__<pod>. Idempotent — re-run to resume a partially opened pod. Warns on cross-pod repo intersections (merge-conflict foresight) and when the demand is not on the TODO board yet: --demand-key <key> --repos <a,b,...> [--no-launch] [--boot-wait-ms]. The pod controller claims the demand itself (controllerWindow is stamped into the state root, so returns route home automatically).",
      "pod-close": "Sweep a pod AFTER its demand archived (order: complete -> stream-close repos -> archive -> pod-close; --force overrides): closes leftover isolation windows (branches land on wakeflow-ledger/workspace/pending-merges.md), removes Controller__/Test__ windows, kills the pod session. Merge-back stays human-reviewed and decentralized: --demand-key <key> [--force].",
      "pod-list": "Read-only pod inventory: demand state, session liveness, isolation windows per pod — the one global view a mutually-unaware pod model needs (orphan-pod detection).",
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
    case "deliver": return commandDeliver();
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
    case "replace-all": return commandReplaceAll();
    case "stream-open": return commandStreamOpen();
    case "stream-close": return commandStreamClose();
    case "stream-list": return commandStreamList();
    case "pod-open": return commandPodOpen();
    case "pod-close": return commandPodClose();
    case "pod-list": return commandPodList();
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
