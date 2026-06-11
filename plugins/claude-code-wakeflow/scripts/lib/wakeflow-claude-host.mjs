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
import { spawnSync } from "node:child_process";
import path from "node:path";

// This helper IS the Claude Code host transport boundary, so it runs the host
// binaries (tmux, claude, brew, osascript) directly with a narrow no-shell
// wrapper instead of lib/wakeflow-process.mjs, whose whitelist intentionally
// keeps host commands out of the shared core runtime scripts.
function execHostText(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
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
    ["set-option", "-t", serverSession, "status-right", "%H:%M"],
    ["set-option", "-t", serverSession, "status-interval", "5"],
    ["set-option", "-t", serverSession, "renumber-windows", "on"],
    ["set-option", "-g", "window-status-format", "#{?#{==:#{@wakeflow_state},busy},#[fg=yellow]>#[default],#{?#{==:#{@wakeflow_state},done},#[fg=green]+#[default],#{?#{==:#{@wakeflow_state},stalled},#[fg=red]!#[default],}}}#I:#{=8:window_name}"],
    ["set-option", "-g", "window-status-current-format", "#[bold,underscore]#{?#{==:#{@wakeflow_state},busy},#[fg=yellow]>#[default]#[bold,underscore],#{?#{==:#{@wakeflow_state},done},#[fg=green]+#[default]#[bold,underscore],#{?#{==:#{@wakeflow_state},stalled},#[fg=red]!#[default]#[bold,underscore],}}}#I:#{=16:window_name}"],
    ["set-option", "-g", "window-status-separator", " "],
  ];
  for (const optionArgs of optionSets) tmux(optionArgs, { allowFailure: true });
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
  const serverSession = getValue("--server", "wakeflow");
  const created = ensureServer(serverSession);
  output({ ok: true, command: "ensure-server", server: serverSession, created });
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
  const serverSession = getValue("--server", "wakeflow");
  const sessionId = getValue("--session-id", hasFlag("--resume") ? null : randomUUID());
  if (!sessionId) fail("--resume requires --session-id <registered session id> (read it from the thread registry).");
  const promptFile = getValue("--prompt-file");
  const bootWaitMs = Number(getValue("--boot-wait-ms", "6000"));
  const extraClaudeArgs = getAllValues("--claude-arg");

  ensureServer(serverSession);
  const existing = existsSync(bindingFileFor(windowName)) ? readJson(bindingFileFor(windowName), "window-host binding") : null;
  if (existing && windowAlive({ tmux: existing.tmux }) && !hasFlag("--replace")) {
    fail(`Window ${windowName} already has a live tmux window (${existing.tmux.windowId}); pass --replace to relaunch.`);
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
  // Default to acceptEdits so seeded allowlists plus edit auto-accept make the
  // window prompt-free; any caller-provided --permission-mode wins.
  const modeArgs = extraClaudeArgs.includes("--permission-mode") ? [] : ["--permission-mode", "acceptEdits"];
  const claudeCommand = [claudeBin, ...sessionArgs, "--add-dir", workspaceRoot, ...modeArgs, ...configClaudeArgs, ...extraClaudeArgs]
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
    // The user already confirmed this directory as a managed window during
    // workspace initialization; accepting the one-time folder trust dialog is
    // inside that consent. --no-auto-trust restores manual handling.
    const bootPane = capturePaneTail(binding, 30);
    if (/trust this folder|Do you trust/i.test(bootPane)) {
      tmux(["send-keys", "-t", binding.tmux.windowId, "Enter"]);
      trustAccepted = true;
      await sleep(3000);
    }
  }
  if (promptFile) {
    pastePromptFile(binding, promptFile);
  }

  output({
    ok: true,
    command: "launch-window",
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
    fail(`tmux window for ${windowName} is not alive (${binding.tmux.windowId}); relaunch it or recover the session headless with: ${claudeBin} -p --resume <registered session id>.`);
  }

  const lock = readLock(windowName);
  if (lock && lockIsFresh(lock) && !hasFlag("--force")) {
    fail(`Window ${windowName} has an in-flight delivery lock (${lock.deliveryId || "unknown delivery"}, host ${lock.host}, expires ${lock.expiresAt}); review or release it before sending, or pass --force.`);
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
      if (lock && (lock.deliveryId === undefined || results.some((result) => result.targetWindow === window))) {
        rmSync(lockFileFor(window), { force: true });
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
  if (hasFlag("--open-terminal") && process.platform === "darwin") {
    const escaped = attach.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const result = execHostText("osascript", ["-e", `tell application "Terminal" to do script "${escaped}"`, "-e", 'tell application "Terminal" to activate']);
    if (result.status !== 0) fail(`Failed to open Terminal window: ${(result.stderr || "").trim()}`);
  }
  output({ ok: true, command: "attach-window", windowName, windowId: binding.tmux.windowId, attach, openedTerminal: hasFlag("--open-terminal") && process.platform === "darwin" });
}

import { hostProfile } from "./wakeflow-host-profile.mjs";

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
  const serverSession = getValue("--server", "wakeflow");
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
  output({ ok: true, command: "arrange-windows", server: serverSession, order: arranged });
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
      "ensure-server": "Create the wakeflow tmux server session when missing (--server wakeflow).",
      "launch-window": "Create one tmux-resident claude window: --window --cwd [--title] [--session-id] [--prompt-file] [--server] [--boot-wait-ms] [--claude-arg ...] [--replace] [--no-auto-trust]. Defaults to --permission-mode acceptEdits and auto-accepts the one-time folder trust dialog. Pass --resume with --session-id to restore a registered session into a fresh window after a reboot.",
      retitle: "Rename the tmux window that hosts a Wakeflow window: --window --title.",
      send: "Paste a prompt file into a window and record pane readback: --window --prompt-file [--delivery-id] [--lock-ttl-sec] [--force].",
      readback: "Capture the current pane tail for evidence: --window [--lines].",
      "release-lock": "Remove the shared in-flight delivery lock for a window: --window.",
      "wait-results": "Block until target results exist for a dispatch group: --group [--state-root <path>] [--target <window>...|--expect N] [--timeout-sec] [--poll-ms]. Scans both the delivery store and the state root target-results.",
      "attach-window": "Print (and optionally open in Terminal) the tmux attach command: --window [--open-terminal].",
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
