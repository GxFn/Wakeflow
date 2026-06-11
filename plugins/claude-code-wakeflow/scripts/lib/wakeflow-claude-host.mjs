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

function ensureServer(serverSession) {
  const present = tmux(["has-session", "-t", serverSession], { allowFailure: true }).status === 0;
  if (!present) {
    tmux(["new-session", "-d", "-s", serverSession, "-c", workspaceRoot]);
  }
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
  const sessionId = getValue("--session-id", randomUUID());
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
  const claudeCommand = [claudeBin, "--session-id", sessionId, "--add-dir", workspaceRoot, ...extraClaudeArgs]
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

  if (promptFile) {
    await sleep(Number.isFinite(bootWaitMs) ? bootWaitMs : 6000);
    pastePromptFile(binding, promptFile);
  }

  output({
    ok: true,
    command: "launch-window",
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
  output({ ok: true, command: "release-lock", windowName, released: Boolean(lock) });
}

function listGroupResults(group) {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(path.join(resultsDir, name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((result) => result && result.dispatchGroup === group);
}

async function commandWaitResults() {
  const group = requireValue("--group");
  const expectedWindows = getAllValues("--target");
  const expectCount = Number(getValue("--expect", expectedWindows.length > 0 ? String(expectedWindows.length) : "1"));
  const timeoutSec = Number(getValue("--timeout-sec", "7200"));
  const pollMs = Math.max(250, Number(getValue("--poll-ms", "2000")));
  const deadline = Date.now() + (Number.isFinite(timeoutSec) ? timeoutSec : 7200) * 1000;

  let found = [];
  for (;;) {
    const results = listGroupResults(group);
    const windows = [...new Set(results.map((result) => result.targetWindow).filter(Boolean))];
    found = expectedWindows.length > 0 ? windows.filter((window) => expectedWindows.includes(window)) : windows;
    for (const window of found) {
      const lock = readLock(window);
      if (lock && (lock.deliveryId === undefined || results.some((result) => result.targetWindow === window))) {
        rmSync(lockFileFor(window), { force: true });
      }
    }
    const satisfied = expectedWindows.length > 0
      ? expectedWindows.every((window) => found.includes(window))
      : found.length >= expectCount;
    if (satisfied) {
      output({ ok: true, command: "wait-results", group, status: "ready", windows: found });
      return;
    }
    if (Date.now() >= deadline) {
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

function commandHelp() {
  output({
    ok: true,
    commands: {
      preflight: "Report tmux/claude/brew availability and the install recommendation.",
      "ensure-server": "Create the wakeflow tmux server session when missing (--server wakeflow).",
      "launch-window": "Create one tmux-resident claude window: --window --cwd [--title] [--session-id] [--prompt-file] [--server] [--boot-wait-ms] [--claude-arg ...] [--replace].",
      retitle: "Rename the tmux window that hosts a Wakeflow window: --window --title.",
      send: "Paste a prompt file into a window and record pane readback: --window --prompt-file [--delivery-id] [--lock-ttl-sec] [--force].",
      readback: "Capture the current pane tail for evidence: --window [--lines].",
      "release-lock": "Remove the shared in-flight delivery lock for a window: --window.",
      "wait-results": "Block until target results exist for a dispatch group: --group [--target <window>...|--expect N] [--timeout-sec] [--poll-ms].",
      "attach-window": "Print (and optionally open in Terminal) the tmux attach command: --window [--open-terminal].",
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
